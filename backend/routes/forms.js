const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Form = require('../models/Form');
const LoadingWarehouse = require('../models/LoadingWarehouse');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('forms')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const escapeRegex = (text = '') =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const validateDistributions = async (quantityLiters, distributions) => {
  if (!Array.isArray(distributions) || distributions.length === 0) {
    return 'يجب إضافة توزيع واحد على الأقل';
  }

  const cleaned = distributions.map((d) => ({
    governorate: String(d.governorate || '').trim(),
    loadingWarehouse: String(d.loadingWarehouse || '').trim(),
    quantityLiters: Number(d.quantityLiters || 0),
    copyType: String(d.copyType || '').trim(),
    receiverName: String(d.receiverName || '').trim(),
  }));

  for (const row of cleaned) {
    if (!row.governorate) return 'المحافظة مطلوبة في جميع التوزيعات';
    if (!row.loadingWarehouse) return 'مستودع التحميل مطلوب في جميع التوزيعات';
    if (!row.quantityLiters || row.quantityLiters <= 0) return 'الكمية المحولة يجب أن تكون أكبر من صفر';
    if (!row.copyType) return 'نسخة الاستمارة مطلوبة في جميع التوزيعات';
    if (!row.receiverName) return 'اسم مستلم الاستمارة مطلوب في جميع التوزيعات';
    if (!mongoose.Types.ObjectId.isValid(row.loadingWarehouse)) {
      return 'يوجد مستودع تحميل غير صالح';
    }
    if (row.quantityLiters > Number(quantityLiters)) {
      return 'لا يمكن أن تكون الكمية المحولة إلى مستودع التحميل أكبر من كمية الاستمارة';
    }
  }

  const warehouseIds = [...new Set(cleaned.map((d) => d.loadingWarehouse))];
  const warehouses = await LoadingWarehouse.find({ _id: { $in: warehouseIds } }).select('name governorate');
  const warehouseMap = new Map(warehouses.map((w) => [String(w._id), w]));

  for (const row of cleaned) {
    const wh = warehouseMap.get(row.loadingWarehouse);
    if (!wh) return 'يوجد مستودع تحميل غير موجود';
    if (normalizeText(wh.governorate) !== normalizeText(row.governorate)) {
      return `المستودع "${wh.name}" لا يتبع المحافظة المختارة`;
    }
  }

  const total = round3(cleaned.reduce((sum, d) => sum + Number(d.quantityLiters || 0), 0));

  if (total > round3(quantityLiters)) {
    return 'مجموع الكميات المحولة لا يمكن أن يتجاوز كمية الاستمارة';
  }

  if (total !== round3(quantityLiters)) {
    return 'مجموع الكميات المحولة يجب أن يساوي كمية الاستمارة';
  }

  return null;
};

router.get('/', protect, canAccess, async (req, res) => {
  try {
    const { search = '', month = '' } = req.query;
    const filter = {};

    if (search.trim()) {
      filter.number = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      filter.formDate = { $gte: start, $lt: end };
    }

    const items = await Form.find(filter)
      .populate('distributions.loadingWarehouse', 'name governorate')
      .sort({ formDate: -1, createdAt: -1 });

    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', protect, canAccess, async (req, res) => {
  try {
    const number = String(req.body.number || '').trim();
    const formDate = req.body.formDate;
    const quantityLiters = Number(req.body.quantityLiters || 0);
    const distributions = Array.isArray(req.body.distributions) ? req.body.distributions : [];

    if (!number) {
      return res.status(400).json({ message: 'رقم الاستمارة مطلوب' });
    }

    if (!formDate) {
      return res.status(400).json({ message: 'تاريخ الاستمارة مطلوب' });
    }

    if (!quantityLiters || quantityLiters <= 0) {
      return res.status(400).json({ message: 'كمية الاستمارة يجب أن تكون أكبر من صفر' });
    }

    const distError = await validateDistributions(quantityLiters, distributions);
    if (distError) {
      return res.status(400).json({ message: distError });
    }

    const item = await Form.create({
      number,
      numberKey: normalizeText(number),
      formDate,
      quantityLiters,
      distributions,
      createdBy: req.user._id,
    });

    await item.populate('distributions.loadingWarehouse', 'name governorate');
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const number = String(req.body.number || '').trim();
    const formDate = req.body.formDate;
    const quantityLiters = Number(req.body.quantityLiters || 0);
    const distributions = Array.isArray(req.body.distributions) ? req.body.distributions : [];

    if (!number) {
      return res.status(400).json({ message: 'رقم الاستمارة مطلوب' });
    }

    if (!formDate) {
      return res.status(400).json({ message: 'تاريخ الاستمارة مطلوب' });
    }

    if (!quantityLiters || quantityLiters <= 0) {
      return res.status(400).json({ message: 'كمية الاستمارة يجب أن تكون أكبر من صفر' });
    }

    const distError = await validateDistributions(quantityLiters, distributions);
    if (distError) {
      return res.status(400).json({ message: distError });
    }

    const item = await Form.findByIdAndUpdate(
      req.params.id,
      {
        number,
        numberKey: normalizeText(number),
        formDate,
        quantityLiters,
        distributions,
      },
      { new: true, runValidators: true }
    ).populate('distributions.loadingWarehouse', 'name governorate');

    if (!item) {
      return res.status(404).json({ message: 'الاستمارة غير موجودة' });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/extensions', protect, canAccess, async (req, res) => {
  try {
    const adminOrderNumber = String(req.body.adminOrderNumber || '').trim();
    const grantedAt = req.body.grantedAt;
    const allowedUntil = req.body.allowedUntil;
    const note = String(req.body.note || '').trim();

    if (!adminOrderNumber) {
      return res.status(400).json({ message: 'رقم الأمر الإداري مطلوب' });
    }

    if (!grantedAt) {
      return res.status(400).json({ message: 'تاريخ التمديد مطلوب' });
    }

    if (!allowedUntil) {
      return res.status(400).json({ message: 'تاريخ انتهاء التمديد مطلوب' });
    }

    if (new Date(allowedUntil) <= new Date(grantedAt)) {
      return res.status(400).json({ message: 'تاريخ انتهاء التمديد يجب أن يكون بعد تاريخ التمديد' });
    }

    const item = await Form.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'الاستمارة غير موجودة' });
    }

    item.extensions.push({
      adminOrderNumber,
      grantedAt,
      allowedUntil,
      note,
    });

    await item.save();
    await item.populate('distributions.loadingWarehouse', 'name governorate');

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const item = await Form.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'الاستمارة غير موجودة' });
    }
    res.json({ message: 'تم حذف الاستمارة بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;