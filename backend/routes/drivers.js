const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('drivers')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

// ===== إعداد Multer =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/drivers';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

const imgFields = upload.fields([
  { name: 'nationalIdFront', maxCount: 1 },
  { name: 'nationalIdBack', maxCount: 1 },
  { name: 'licenseFront', maxCount: 1 },
  { name: 'licenseBack', maxCount: 1 },
]);

const getImagePaths = (files = {}) => ({
  nationalIdFront: files.nationalIdFront?.[0]?.path?.replace(/\\/g, '/') || undefined,
  nationalIdBack: files.nationalIdBack?.[0]?.path?.replace(/\\/g, '/') || undefined,
  licenseFront: files.licenseFront?.[0]?.path?.replace(/\\/g, '/') || undefined,
  licenseBack: files.licenseBack?.[0]?.path?.replace(/\\/g, '/') || undefined,
});

// حذف صورة قديمة من الديسك
const deleteOldImage = (filePath) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
};

// ===== جلب الكل أو بحث =====
router.get('/', protect, canAccess, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const drivers = await Driver.find(filter).sort({ createdAt: -1 });
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== Live Search لـ Unloading =====
router.post('/search', protect, canAccess, async (req, res) => {
  try {
    const { q, limit = 5 } = req.body;
    if (!q || q.trim().length < 2) {
      return res.json([]);
    }
    
    const searchTerm = q.trim();
    const drivers = await Driver.find({ 
      name: { $regex: searchTerm, $options: 'i' } 
    })
    .select('name _id')
    .sort({ name: 1 })
    .limit(parseInt(limit));

    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== إضافة سائق =====
router.post('/', protect, canAccess, imgFields, async (req, res) => {
  try {
    const {
      name,
      motherName,
      birthDate,
      nationalId,
      nationalIdExpiry,
      address,
      licenseType,
      licenseExpiry,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: 'اسم السائق مطلوب' });
    if (!motherName?.trim()) return res.status(400).json({ message: 'اسم الأم مطلوب' });
    if (nationalId && !/^\d{12}$/.test(nationalId.trim())) {
      return res.status(400).json({ message: 'رقم البطاقة الوطنية يجب أن يتكون من 12 رقماً' });
    }

    const imgs = getImagePaths(req.files);
    const driver = await Driver.create({
      name: name.trim(),
      motherName: motherName.trim(),
      birthDate: birthDate || null,
      nationalId: nationalId?.trim() || '',
      nationalIdExpiry: nationalIdExpiry || null,
      address: address?.trim() || '',
      licenseType: licenseType?.trim() || '',
      licenseExpiry: licenseExpiry || null,
      nationalIdFront: imgs.nationalIdFront || '',
      nationalIdBack: imgs.nationalIdBack || '',
      licenseFront: imgs.licenseFront || '',
      licenseBack: imgs.licenseBack || '',
      createdBy: req.user._id,
    });

    res.status(201).json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== استيراد من Excel (bulk) =====
router.post('/bulk', protect, canAccess, async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'لا توجد بيانات للاستيراد' });
    }

    const results = { success: 0, failed: 0, skipped: 0, errors: [] };

    for (const row of rows) {
      try {
        if (!row.name?.trim()) {
          results.failed++;
          results.errors.push('سجل بدون اسم — تم تخطيه');
          continue;
        }

        const exists = await Driver.findOne({
          name: { $regex: `^${row.name.trim()}$`, $options: 'i' },
        });
        if (exists) {
          results.skipped++;
          continue;
        }

        if (row.nationalId && !/^\d{12}$/.test(row.nationalId.trim())) {
          results.failed++;
          results.errors.push(`"${row.name}" — رقم البطاقة يجب أن يكون 12 رقماً`);
          continue;
        }

        await Driver.create({
          name: row.name.trim(),
          motherName: row.motherName?.trim() || '',
          birthDate: row.birthDate || null,
          nationalId: row.nationalId?.trim() || '',
          nationalIdExpiry: row.nationalIdExpiry || null,
          address: row.address?.trim() || '',
          licenseType: row.licenseType?.trim() || '',
          licenseExpiry: row.licenseExpiry || null,
          createdBy: req.user._id,
        });
        results.success++;
      } catch (err) {
        results.failed++;
        const reason = err?.errors
          ? Object.values(err.errors).map((e) => e.message).join(', ')
          : err.message || 'خطأ غير معروف';
        results.errors.push(`"${row.name}" — ${reason}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== تعديل سائق =====
router.put('/:id', protect, canAccess, imgFields, async (req, res) => {
  try {
    const {
      name,
      motherName,
      birthDate,
      nationalId,
      nationalIdExpiry,
      address,
      licenseType,
      licenseExpiry,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: 'اسم السائق مطلوب' });
    if (!motherName?.trim()) return res.status(400).json({ message: 'اسم الأم مطلوب' });
    if (nationalId && !/^\d{12}$/.test(nationalId.trim())) {
      return res.status(400).json({ message: 'رقم البطاقة الوطنية يجب أن يتكون من 12 رقماً' });
    }

    const imgs = getImagePaths(req.files);
    const update = {
      name: name.trim(),
      motherName: motherName.trim(),
      birthDate: birthDate || null,
      nationalId: nationalId?.trim() || '',
      nationalIdExpiry: nationalIdExpiry || null,
      address: address?.trim() || '',
      licenseType: licenseType?.trim() || '',
      licenseExpiry: licenseExpiry || null,
    };

    // احذف الصورة القديمة واستبدلها بالجديدة فقط إن وُجدت
    const old = await Driver.findById(req.params.id);
    if (old) {
      if (imgs.nationalIdFront) {
        deleteOldImage(old.nationalIdFront);
        update.nationalIdFront = imgs.nationalIdFront;
      }
      if (imgs.nationalIdBack) {
        deleteOldImage(old.nationalIdBack);
        update.nationalIdBack = imgs.nationalIdBack;
      }
      if (imgs.licenseFront) {
        deleteOldImage(old.licenseFront);
        update.licenseFront = imgs.licenseFront;
      }
      if (imgs.licenseBack) {
        deleteOldImage(old.licenseBack);
        update.licenseBack = imgs.licenseBack;
      }
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!driver) return res.status(404).json({ message: 'السائق غير موجود' });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== حذف مفرد =====
router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) return res.status(404).json({ message: 'السائق غير موجود' });

    // حذف الصور من الديسك
    deleteOldImage(driver.nationalIdFront);
    deleteOldImage(driver.nationalIdBack);
    deleteOldImage(driver.licenseFront);
    deleteOldImage(driver.licenseBack);

    res.json({ message: 'تم حذف السائق بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== حذف جماعي =====
router.delete('/bulk', protect, canAccess, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'لم يتم تحديد أي سجلات' });
    }

    // احذف صور كل سائق من الديسك
    const drivers = await Driver.find({ _id: { $in: ids } });
    drivers.forEach((d) => {
      deleteOldImage(d.nationalIdFront);
      deleteOldImage(d.nationalIdBack);
      deleteOldImage(d.licenseFront);
      deleteOldImage(d.licenseBack);
    });

    const result = await Driver.deleteMany({ _id: { $in: ids } });
    res.json({
      message: `تم حذف ${result.deletedCount} سائق بنجاح`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;