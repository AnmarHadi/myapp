const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let reconnectTimer = null;
let connecting = false;
let listenersBound = false;

function getMongoUri() {
  const rawUri = process.env.MONGODB_URI;

  if (!rawUri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env, for example: mongodb://127.0.0.1:27017/myapp'
    );
  }

  try {
    const parsed = new URL(rawUri);

    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      return parsed.toString();
    }
  } catch (_error) {
    // Non-URL connection strings are left unchanged.
  }

  return rawUri;
}

function buildMongoHelpMessage(error) {
  const message = error?.message || 'Unknown MongoDB error';
  const uri = process.env.MONGODB_URI || '(missing)';

  if (/ECONNREFUSED/i.test(message) && /27017/.test(message)) {
    return [
      message,
      `MongoDB is not accepting connections at ${uri}.`,
      'If you want a local database, start the MongoDB service on your machine.',
      'If you want a remote database, update MONGODB_URI in backend/.env.',
    ].join('\n');
  }

  if (/MONGODB_URI is not set/i.test(message)) {
    return message;
  }

  return message;
}

function scheduleReconnect(delayMs = 5000) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDBWithRetry().catch(() => {});
  }, delayMs);
}

function bindConnectionListeners() {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('disconnected', () => {
    console.error('MongoDB disconnected. Retrying in 5 seconds...');
    scheduleReconnect(5000);
  });

  mongoose.connection.on('error', (error) => {
    console.error(`MongoDB connection error: ${buildMongoHelpMessage(error)}`);
  });
}

async function connectDBWithRetry() {
  if (connecting || mongoose.connection.readyState === 1) return;
  connecting = true;

  try {
    const conn = await mongoose.connect(getMongoUri(), {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    bindConnectionListeners();
  } catch (error) {
    console.error(`MongoDB Error: ${buildMongoHelpMessage(error)}`);
    scheduleReconnect(5000);
  } finally {
    connecting = false;
  }
}

module.exports = connectDBWithRetry;