const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

function normalizeUsername(username = '') {
  return String(username).trim();
}

// التحقق إذا تم إعداد التطبيق (هل يوجد أدمن)
router.get('/check-setup', async (req, res) => {
  try {
    if (!isDatabaseReady()) {
      return res.json({
        isSetup: null,
        code: 'database_unavailable',
        message: 'قاعدة البيانات غير متصلة بعد',
      });
    }

    const adminExists = await User.findOne({ isAdmin: true });
    res.json({ isSetup: !!adminExists });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// إنشاء حساب الأدمن (يُستخدم مرة واحدة فقط)
router.post('/setup', async (req, res) => {
  try {
    const { username, password } = req.body;
    const normalizedUsername = normalizeUsername(username);

    const adminExists = await User.findOne({ isAdmin: true });
    if (adminExists) {
      return res.status(400).json({ message: 'المدير موجود مسبقاً' });
    }

    if (!normalizedUsername || !password) {
      return res.status(400).json({ message: 'يرجى تعبئة جميع الحقول' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      username: normalizedUsername,
      password: hashedPassword,
      role: 'admin',
      isAdmin: true,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    res.status(201).json({
      _id: user._id,
      username: user.username,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// تسجيل الدخول
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername || !password) {
      return res.status(400).json({ message: 'يرجى تعبئة جميع الحقول' });
    }

    const user = await User.findOne({ username: normalizedUsername });
    if (!user) {
      return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    res.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// الحصول على بيانات المستخدم الحالي
router.get('/me', async (req, res) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
      return res.json(user);
    }
    res.status(401).json({ message: 'غير مصرح' });
  } catch (error) {
    res.status(401).json({ message: 'الرمز غير صالح' });
  }
});

module.exports = router;
