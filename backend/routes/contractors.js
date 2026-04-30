const express = require('express');
const router  = express.Router();
const Contractor = require('../models/Contractor');
const { protect } = require('../middleware/auth');

// التحقق من رقم الهاتف
const validatePhone = (phone) => {
  if (!phone || !phone.trim()) return 'رقم الهاتف مطلوب';
  if (!/^07\d{9}$/.test(phone.trim()))
    return 'رقم الهاتف يجب أن يتكون من 11 رقماً ويبدأ بـ 07';
  return null;
};

// صلاحية الوصول: أدمن أو من يملك الإذن (نفس المفتاح القديم في الصلاحيات)
const canAccess = (req, res, next) => {
  if (
    req.user.isAdmin ||
    (req.user.permissions &&
      req.user.permissions.includes('vehicleOwners'))
  ) {
    return next();
  }
  return res
    .status(403)
    .json({ message: 'ليس لديك صلاحية الوصول لهذه الصفحة' });
};

// جلب الكل
router.get('/', protect, canAccess, async (req, res) => {
  try {
    const contractors = await Contractor.find().sort({ createdAt: -1 });
    res.json(contractors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// إضافة جديد
router.post('/', protect, canAccess, async (req, res) => {
  try {
    const { name, address, phone } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: 'اسم المتعهد مطلوب' });
    }

    const phoneError = validatePhone(phone);
    if (phoneError)
      return res.status(400).json({ message: phoneError });

    const exists = await Contractor.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
    });
    if (exists) {
      return res.status(400).json({
        message: 'اسم المتعهد موجود مسبقاً، يجب أن يكون فريداً',
      });
    }

    const contractor = await Contractor.create({
      name: name.trim(),
      address: address?.trim() || '',
      phone: phone.trim(),
      createdBy: req.user._id,
    });

    res.status(201).json(contractor);
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(400)
        .json({ message: 'اسم المتعهد موجود مسبقاً' });
    }
    res.status(500).json({ message: err.message });
  }
});

// تعديل
router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const { name, address, phone } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: 'اسم المتعهد مطلوب' });
    }

    const phoneError = validatePhone(phone);
    if (phoneError)
      return res.status(400).json({ message: phoneError });

    const exists = await Contractor.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      _id: { $ne: req.params.id },
    });
    if (exists) {
      return res
        .status(400)
        .json({ message: 'اسم المتعهد موجود مسبقاً' });
    }

    const contractor = await Contractor.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        address: address?.trim() || '',
        phone: phone.trim(),
      },
      { new: true, runValidators: true }
    );

    if (!contractor)
      return res
        .status(404)
        .json({ message: 'المتعهد غير موجود' });

    res.json(contractor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// حذف
router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const contractor = await Contractor.findByIdAndDelete(
      req.params.id
    );
    if (!contractor)
      return res
        .status(404)
        .json({ message: 'المتعهد غير موجود' });
    res.json({ message: 'تم حذف المتعهد بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;