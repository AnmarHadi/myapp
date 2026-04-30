const express = require('express');
const router = express.Router();
const TripPricing = require('../models/TripPricing');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const { operationType } = req.query || {};
    const filter = {};

    if (operationType) {
      filter.operationType = operationType;
    }

    const data = await TripPricing.find(filter)
      .populate('loadingWarehouse', 'name governorate')
      .sort({ createdAt: -1 });

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'فشل في جلب الأسعار' });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const item = await TripPricing.create({
      operationType: req.body.operationType,
      loadingWarehouse: req.body.loadingWarehouse,
      pricingType: req.body.pricingType,
      price: req.body.price ?? 0,
      advance: req.body.advance ?? 0,
      capacityFrom: req.body.capacityFrom ?? null,
      capacityTo: req.body.capacityTo ?? null,
      createdBy: req.user._id,
    });

    await item.populate('loadingWarehouse', 'name governorate');

    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message || 'فشل في إضافة السعر' });
  }
});

router.put('/:id', protect, async (req, res) => {
  try {
    const item = await TripPricing.findByIdAndUpdate(
      req.params.id,
      {
        operationType: req.body.operationType,
        loadingWarehouse: req.body.loadingWarehouse,
        pricingType: req.body.pricingType,
        price: req.body.price ?? 0,
        advance: req.body.advance ?? 0,
        capacityFrom: req.body.capacityFrom ?? null,
        capacityTo: req.body.capacityTo ?? null,
      },
      { new: true, runValidators: true }
    ).populate('loadingWarehouse', 'name governorate');

    if (!item) {
      return res.status(404).json({ message: 'سجل السعر غير موجود' });
    }

    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message || 'فشل في تعديل السعر' });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    await TripPricing.findByIdAndDelete(req.params.id);
    res.json({ message: 'تم الحذف' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'فشل في حذف السعر' });
  }
});

module.exports = router;