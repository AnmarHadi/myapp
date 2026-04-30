const express = require('express')
const router = express.Router()
const Product = require('../models/Product')
const { protect } = require('../middleware/auth')

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('products')) return next()
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' })
}

const normalizeName = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase()

router.get('/', protect, canAccess, async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 })
    res.json(items)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()

    if (!name) {
      return res.status(400).json({ message: 'اسم المنتج مطلوب' })
    }

    const item = await Product.create({
      name,
      nameKey: normalizeName(name),
      createdBy: req.user._id,
    })

    res.status(201).json(item)
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'اسم المنتج موجود مسبقاً' })
    }
    res.status(500).json({ message: err.message })
  }
})

router.put('/:id', protect, canAccess, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()

    if (!name) {
      return res.status(400).json({ message: 'اسم المنتج مطلوب' })
    }

    const item = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name,
        nameKey: normalizeName(name),
      },
      { new: true, runValidators: true }
    )

    if (!item) {
      return res.status(404).json({ message: 'المنتج غير موجود' })
    }

    res.json(item)
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'اسم المنتج موجود مسبقاً' })
    }
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const item = await Product.findByIdAndDelete(req.params.id)

    if (!item) {
      return res.status(404).json({ message: 'المنتج غير موجود' })
    }

    res.json({ message: 'تم حذف المنتج بنجاح' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
