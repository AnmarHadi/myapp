const express = require('express');
const router = express.Router();

const UnloadingDestination = require('../models/UnloadingDestination');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  const user = req.user;
  if (user && (user.isAdmin || user.permissions?.includes('loadingDestinations'))) {
    return next();
  }
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const escapeRegex = (text = '') =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

const makeKeys = (name = '', governorate = '') => ({
  nameKey: normalizeText(name),
  governorateKey: normalizeText(governorate),
});

// ===== GET all / search =====
router.get('/', protect, canAccess, async (req, res) => {
  try {
    const { search } = req.query;
    let filter = {};

    if (search?.trim()) {
      filter = {
        $or: [
          { name: { $regex: escapeRegex(search.trim()), $options: 'i' } },
          { governorate: { $regex: escapeRegex(search.trim()), $options: 'i' } },
        ],
      };
    }

    const items = await UnloadingDestination.find(filter).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== POST create =====
router.post('/', protect, canAccess, async (req, res) => {
  try {
    const { name, governorate } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: 'اسم وجهة التفريغ مطلوب' });
    }

    if (!governorate?.trim()) {
      return res.status(400).json({ message: 'المحافظة مطلوبة' });
    }

    const cleanName = String(name).trim();
    const cleanGovernorate = String(governorate).trim();
    const keys = makeKeys(cleanName, cleanGovernorate);

    const item = await UnloadingDestination.create({
      name: cleanName,
      governorate: cleanGovernorate,
      ...keys,
      createdBy: req.user._id,
    });

    res.status(201).json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: 'اسم وجهة التفريغ موجود مسبقاً ضمن نفس المحافظة',
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// ===== PUT update =====
router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const { name, governorate } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: 'اسم وجهة التفريغ مطلوب' });
    }

    if (!governorate?.trim()) {
      return res.status(400).json({ message: 'المحافظة مطلوبة' });
    }

    const cleanName = String(name).trim();
    const cleanGovernorate = String(governorate).trim();
    const keys = makeKeys(cleanName, cleanGovernorate);

    const item = await UnloadingDestination.findByIdAndUpdate(
      req.params.id,
      {
        name: cleanName,
        governorate: cleanGovernorate,
        ...keys,
      },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'وجهة التفريغ غير موجودة' });
    }

    res.json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: 'اسم وجهة التفريغ موجود مسبقاً ضمن نفس المحافظة',
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// ===== DELETE single =====
router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const item = await UnloadingDestination.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'وجهة التفريغ غير موجودة' });
    }

    res.json({ message: 'تم حذف وجهة التفريغ بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;