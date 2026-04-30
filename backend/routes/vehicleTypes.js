const express = require('express');
const router = express.Router();
const VehicleType = require('../models/VehicleType');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('vehicleTypes')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const normalizeName = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

router.get('/', protect, canAccess, async (req, res) => {
  try {
    const items = await VehicleType.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'اسم نوع المركبة مطلوب' });
    }

    const item = await VehicleType.create({
      name,
      nameKey: normalizeName(name),
      createdBy: req.user._id,
    });

    res.status(201).json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'نوع المركبة موجود مسبقاً' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'اسم نوع المركبة مطلوب' });
    }

    const item = await VehicleType.findByIdAndUpdate(
      req.params.id,
      { name, nameKey: normalizeName(name) },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'نوع المركبة غير موجود' });
    }

    res.json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'نوع المركبة موجود مسبقاً' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const item = await VehicleType.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({ message: 'نوع المركبة غير موجود' });
    }

    res.json({ message: 'تم حذف نوع المركبة بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;