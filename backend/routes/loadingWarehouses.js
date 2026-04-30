const express = require('express');
const router = express.Router();
const LoadingWarehouse = require('../models/LoadingWarehouse');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('loadingWarehouses')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const normalizeText = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

router.get('/', protect, canAccess, async (req, res) => {
  try {
    const items = await LoadingWarehouse.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const governorate = String(req.body.governorate || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'اسم مستودع التحميل مطلوب' });
    }

    if (!governorate) {
      return res.status(400).json({ message: 'المحافظة مطلوبة' });
    }

    const item = await LoadingWarehouse.create({
      name,
      governorate,
      nameKey: normalizeText(name),
      governorateKey: normalizeText(governorate),
      createdBy: req.user._id,
    });

    res.status(201).json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'اسم مستودع التحميل موجود مسبقاً في نفس المحافظة' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const governorate = String(req.body.governorate || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'اسم مستودع التحميل مطلوب' });
    }

    if (!governorate) {
      return res.status(400).json({ message: 'المحافظة مطلوبة' });
    }

    const item = await LoadingWarehouse.findByIdAndUpdate(
      req.params.id,
      {
        name,
        governorate,
        nameKey: normalizeText(name),
        governorateKey: normalizeText(governorate),
      },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'مستودع التحميل غير موجود' });
    }

    res.json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'اسم مستودع التحميل موجود مسبقاً في نفس المحافظة' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const item = await LoadingWarehouse.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({ message: 'مستودع التحميل غير موجود' });
    }

    res.json({ message: 'تم حذف مستودع التحميل بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;