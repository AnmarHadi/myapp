const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./config/db');
const Groq = require('groq-sdk'); // لإضافة مسار debug

// تحميل المتغيرات البيئية والاتصال بقاعدة البيانات
dotenv.config();
connectDB();

const app = express();

// إعدادات عامة
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// خدمة الملفات الثابتة (الصور وغيرها)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// الراوترات الأساسية
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contractors', require('./routes/contractors'));
app.use('/api/vehicle-types', require('./routes/vehicleTypes'));
app.use('/api/loading-warehouses', require('./routes/loadingWarehouses'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/forms', require('./routes/forms'));
app.use('/api/trip-pricing', require('./routes/tripPricing'));
app.use('/api/loading-destinations', require('./routes/loadingDestinations'));
app.use('/api/unloading-records', require('./routes/unloadingRecords'));
app.use('/api/loading-records', require('./routes/loadingRecords'));
app.use('/api/products', require('./routes/products'));
const templateRoutes = require('./routes/template.routes')
app.use('/api/templates', templateRoutes)
app.use('/api/unloading-destinations', require('./routes/unloadingDestinations'));
app.use('/api/scanner', require('./routes/scanner.routes'));
// راوتر قراءة البيانات من الصور (Groq)
const imageDataRoutes = require('./routes/imageData.routes');
app.use('/api/image-data', imageDataRoutes);

// مسارات Debug بسيطة لفحص البيانات المحفوظة فعليًا في نفس MongoDB
const Driver = require('./models/Driver');
const Vehicle = require('./models/Vehicle');


app.get('/debug/drivers', async (req, res) => {
  try {
    const docs = await Driver.find({}).sort({ _id: -1 }).limit(10).lean();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug/vehicles', async (req, res) => {
  try {
    const docs = await Vehicle.find({}).sort({ _id: -1 }).limit(10).lean();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ مسار Debug لمعرفة نماذج Groq المتاحة
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
app.get('/debug/groq-models', async (req, res) => {
  try {
    const models = await groq.models.list();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسار رئيسي بسيط
app.get('/', (req, res) => res.json({ message: '🚀 Server is running' }));
app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok' }));

// تشغيل السيرفر
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
