const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const mongoDbPath = process.env.MONGO_DBPATH
  ? path.resolve(process.env.MONGO_DBPATH)
  : path.join(backendDir, '.mongo-data-restored');
const mongoServiceName = 'MongoDB';

const startedChildren = [];
let mongoProcess = null;
let keepAliveTimer = null;
let shuttingDown = false;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function findMongod() {
  const candidates = [
    process.env.MONGOD_PATH,
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isPortOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPort(host, port, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(host, port, 500)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function startProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  startedChildren.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code === 0) {
      console.log(`[${label}] exited cleanly.`);
      return;
    }

    console.error(
      `[${label}] stopped unexpectedly${signal ? ` (signal ${signal})` : ''}${code ? ` with code ${code}` : ''}.`
    );
    shutdown(1);
  });

  return child;
}

function stopChild(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill();
  } catch (_error) {
    // Ignore cleanup failures.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  for (const child of startedChildren.reverse()) {
    stopChild(child);
  }

  if (mongoProcess) {
    stopChild(mongoProcess);
  }

  process.exitCode = code;
  setTimeout(() => process.exit(code), 100);
}

async function ensureMongo() {
  const mongoReady = await isPortOpen('127.0.0.1', 27017, 1000);
  if (mongoReady) {
    console.log('[mongo] already running on 127.0.0.1:27017');
    return;
  }

  try {
    const serviceInfo = await new Promise((resolve, reject) => {
      const service = spawn('sc.exe', ['query', mongoServiceName], {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      service.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      service.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      service.on('error', reject);
      service.on('exit', (code) => {
        if (code === 0) {
          resolve(stdout || stderr);
        } else {
          resolve(null);
        }
      });
    });

    if (serviceInfo) {
      console.log('[mongo] starting Windows MongoDB service...');
      const startResult = spawn('sc.exe', ['start', mongoServiceName], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: false,
      });

      await new Promise((resolve, reject) => {
        startResult.on('error', reject);
        startResult.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`MongoDB service failed to start (exit code ${code})`));
          }
        });
      });

      const mongoUpViaService = await waitForPort('127.0.0.1', 27017, 20000);
      if (mongoUpViaService) {
        return;
      }
    }
  } catch (error) {
    console.warn(`[mongo] service start failed: ${error.message || error}`);
  }

  const mongodPath = findMongod();
  if (!mongodPath) {
    throw new Error(
      'mongod.exe was not found. Install MongoDB or set MONGOD_PATH to the MongoDB server executable.'
    );
  }

  if (!fs.existsSync(mongoDbPath)) {
    throw new Error(`MongoDB data directory not found: ${mongoDbPath}`);
  }

  console.log('[mongo] starting local MongoDB...');
  mongoProcess = spawn(
    mongodPath,
    ['--dbpath', mongoDbPath, '--bind_ip', '127.0.0.1', '--port', '27017'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    }
  );

  mongoProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code === 0) {
      console.log('[mongo] exited cleanly.');
      return;
    }

    console.error(
      `[mongo] stopped unexpectedly${signal ? ` (signal ${signal})` : ''}${code ? ` with code ${code}` : ''}.`
    );
    shutdown(1);
  });

  const mongoUp = await waitForPort('127.0.0.1', 27017, 20000);
  if (!mongoUp) {
    throw new Error('MongoDB did not become ready on 127.0.0.1:27017');
  }
}

async function main() {
  const backendUp = await isPortOpen('127.0.0.1', 5000, 1000);
  const frontendUp = await isPortOpen('127.0.0.1', 5173, 1000);

  await ensureMongo();

  if (backendUp) {
    console.log('[backend] already running on 127.0.0.1:5000');
  } else {
    console.log('[backend] starting...');
    startProcess('backend', npmCommand(), ['start'], backendDir);
    const backendReady = await waitForPort('127.0.0.1', 5000, 20000);
    if (!backendReady) {
      throw new Error('Backend did not become ready on 127.0.0.1:5000');
    }
  }

  if (frontendUp) {
    console.log('[frontend] already running on 127.0.0.1:5173');
  } else {
    console.log('[frontend] starting...');
    startProcess('frontend', npmCommand(), ['run', 'dev', '--', '--host', '127.0.0.1'], frontendDir);
    const frontendReady = await waitForPort('127.0.0.1', 5173, 20000);
    if (!frontendReady) {
      throw new Error('Frontend did not become ready on 127.0.0.1:5173');
    }
  }

  console.log('');
  console.log('All services are ready:');
  console.log('  MongoDB  http://127.0.0.1:27017');
  console.log('  Backend  http://127.0.0.1:5000');
  console.log('  Frontend http://127.0.0.1:5173');
  console.log('Press Ctrl+C to stop the services started by this script.');

  keepAliveTimer = setInterval(() => {}, 24 * 60 * 60 * 1000);
  await new Promise(() => {});
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  shutdown(1);
});

main().catch((error) => {
  console.error(error.message || error);
  shutdown(1);
});
