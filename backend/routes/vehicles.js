const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Vehicle = require('../models/Vehicle');
const VehicleOwner = require('../models/Contractor');
const VehicleType = require('../models/VehicleType');
const Driver = require('../models/Driver');
const { protect } = require('../middleware/auth');

const canAccess = (req, res, next) => {
  const user = req.user;
  if (user && (user.isAdmin || user.permissions?.includes('vehicles'))) {
    return next();
  }
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const escapeRegex = (text = '') =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeVehicleNumber = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toUpperCase();

const normalizeCapacity = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 5) return 'INVALID';

  const parsed = parseInt(digits, 10);
  if (Number.isNaN(parsed)) return null;
  if (parsed < 0 || parsed > 99999) return 'INVALID';

  return parsed;
};

const makeKeys = (vehicleNumber = '', governorate = '') => ({
  vehicleNumberKey: normalizeText(vehicleNumber),
  governorateKey: normalizeText(governorate),
});

const duplicateMessage = (vehicleNumber, governorate = '') =>
  `المركبة "${vehicleNumber}"${governorate ? ` - ${governorate}` : ''} موجودة مسبقاً`;

const resolveOwner = async (rawOwner) => {
  if (!rawOwner || !String(rawOwner).trim()) return null;

  if (mongoose.Types.ObjectId.isValid(rawOwner)) {
    return await VehicleOwner.findById(rawOwner);
  }

  return await VehicleOwner.findOne({
    name: { $regex: `^${escapeRegex(String(rawOwner).trim())}$`, $options: 'i' },
  });
};

const resolveVehicleType = async (rawType) => {
  if (!rawType || !String(rawType).trim()) return null;

  if (mongoose.Types.ObjectId.isValid(rawType)) {
    return await VehicleType.findById(rawType);
  }

  return await VehicleType.findOne({
    name: { $regex: `^${escapeRegex(String(rawType).trim())}$`, $options: 'i' },
  });
};

const resolveDriver = async (rawDriver) => {
  if (!rawDriver || !String(rawDriver).trim()) return null;

  if (mongoose.Types.ObjectId.isValid(rawDriver)) {
    return await Driver.findById(rawDriver);
  }

  return await Driver.findOne({
    name: { $regex: `^${escapeRegex(String(rawDriver).trim())}$`, $options: 'i' },
  });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/vehicles';
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
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const imgFields = upload.fields([
  { name: 'annualImage', maxCount: 1 },
  { name: 'calibrationImage', maxCount: 1 },
]);

const getImagePaths = (files = {}) => ({
  annualImage: files.annualImage?.[0]?.path?.replace(/\\/g, '/') || undefined,
  calibrationImage: files.calibrationImage?.[0]?.path?.replace(/\\/g, '/') || undefined,
});

const deleteOldImage = (filePath) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
};

// ===== GET all / search =====
router.get('/', protect, canAccess, async (req, res) => {
  try {
    const { search } = req.query;
    let filter = {};

    if (search?.trim()) {
      const ownerIds = await VehicleOwner.find({
        name: { $regex: escapeRegex(search.trim()), $options: 'i' },
      }).distinct('_id');

      const typeIds = await VehicleType.find({
        name: { $regex: escapeRegex(search.trim()), $options: 'i' },
      }).distinct('_id');

      const driverIds = await Driver.find({
        name: { $regex: escapeRegex(search.trim()), $options: 'i' },
      }).distinct('_id');

      const searchNumber = Number(search.trim());
      const canSearchCapacity =
        !Number.isNaN(searchNumber) && Number.isInteger(searchNumber);

      filter = {
        $or: [
          { vehicleNumber: { $regex: escapeRegex(search.trim()), $options: 'i' } },
          { governorate: { $regex: escapeRegex(search.trim()), $options: 'i' } },
          ...(canSearchCapacity ? [{ capacity: searchNumber }] : []),
          { owner: { $in: ownerIds } },
          { vehicleType: { $in: typeIds } },
          { driver: { $in: driverIds } },
        ],
      };
    }

    const vehicles = await Vehicle.find(filter)
      .populate('owner', 'name')
      .populate('vehicleType', 'name')
      .populate('driver', 'name')
      .sort({ createdAt: -1 });

    res.json(vehicles);
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
    const vehicles = await Vehicle.find({ 
      $or: [
        { vehicleNumber: { $regex: searchTerm, $options: 'i' } },
        { governorate: { $regex: searchTerm, $options: 'i' } },
      ]
    })
    .populate('driver', 'name')
    .select('vehicleNumber governorate driver _id')
    .sort({ vehicleNumber: 1 })
    .limit(parseInt(limit));

    const formatted = vehicles.map(v => ({
      _id: v._id,
      vehicleNumber: v.vehicleNumber + (v.governorate ? ` (${v.governorate})` : ''),
      display: `${v.vehicleNumber}${v.governorate ? ` - ${v.governorate}` : ''}${v.driver ? ` | ${v.driver.name}` : ''}`
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== POST create =====
router.post('/', protect, canAccess, imgFields, async (req, res) => {
  try {
    const {
      owner,
      vehicleType,
      driver,
      vehicleNumber,
      governorate,
      capacity,
      annualExpiry,
      calibrationExpiry,
    } = req.body;

    if (!vehicleType) {
      return res.status(400).json({ message: 'نوع المركبة مطلوب' });
    }

    if (!vehicleNumber?.trim()) {
      return res.status(400).json({ message: 'رقم المركبة مطلوب' });
    }

    const normalizedCapacity = normalizeCapacity(capacity);
    if (normalizedCapacity === 'INVALID') {
      return res.status(400).json({
        message: 'حمولة المركبة يجب أن تكون رقماً صحيحاً من خمس مراتب كحد أقصى',
      });
    }

    let foundOwner = null;
    if (owner && String(owner).trim()) {
      foundOwner = await resolveOwner(owner);
    }

    const foundType = await resolveVehicleType(vehicleType);
    if (!foundType) {
      return res.status(400).json({ message: 'نوع المركبة غير موجود' });
    }

    let foundDriver = null;
    if (driver && String(driver).trim()) {
      foundDriver = await resolveDriver(driver);
      if (!foundDriver) {
        return res.status(400).json({ message: 'سائق المركبة غير موجود' });
      }
    }

    const cleanVehicleNumber = normalizeVehicleNumber(vehicleNumber);
    const cleanGovernorate = String(governorate || '').trim();
    const keys = makeKeys(cleanVehicleNumber, cleanGovernorate);
    const imgs = getImagePaths(req.files);

    const vehicle = await Vehicle.create({
      owner: foundOwner?._id || null,
      vehicleType: foundType._id,
      driver: foundDriver?._id || null,
      vehicleNumber: cleanVehicleNumber,
      governorate: cleanGovernorate,
      capacity: normalizedCapacity,
      annualExpiry: annualExpiry || null,
      calibrationExpiry: calibrationExpiry || null,
      annualImage: imgs.annualImage || '',
      calibrationImage: imgs.calibrationImage || '',
      ...keys,
      createdBy: req.user._id,
    });

    await vehicle.populate('owner', 'name');
    await vehicle.populate('vehicleType', 'name');
    await vehicle.populate('driver', 'name');

    res.status(201).json(vehicle);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: duplicateMessage(req.body.vehicleNumber, req.body.governorate),
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// ===== POST bulk import =====
router.post('/bulk', protect, canAccess, async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'لا توجد بيانات للاستيراد' });
    }

    const results = { success: 0, failed: 0, skipped: 0, errors: [] };

    for (const row of rows) {
      try {
        if (!row.vehicleNumber?.trim()) {
          results.failed++;
          results.errors.push('سجل بدون رقم مركبة — تم تخطيه');
          continue;
        }

        const cleanVehicleNumber = normalizeVehicleNumber(row.vehicleNumber);
        const cleanGovernorate = String(row.governorate || '').trim();
        const keys = makeKeys(cleanVehicleNumber, cleanGovernorate);

        const exists = await Vehicle.findOne(keys);
        if (exists) {
          results.skipped++;
          continue;
        }

        const normalizedCapacity = normalizeCapacity(row.capacity);
        if (normalizedCapacity === 'INVALID') {
          results.failed++;
          results.errors.push(
            `"${row.vehicleNumber}" — حمولة المركبة يجب أن تكون رقماً صحيحاً من خمس مراتب كحد أقصى`
          );
          continue;
        }

        let ownerId = null;
        let vehicleTypeId = null;
        let driverId = null;

        const rawOwner =
          row.ownerId || row.owner || row.ownerName || row.vehicleOwner || '';
        if (rawOwner && String(rawOwner).trim()) {
          const foundOwner = await resolveOwner(rawOwner);
          if (foundOwner) {
            ownerId = foundOwner._id;
          }
        }

        const rawType =
          row.vehicleTypeId ||
          row.vehicleType ||
          row.type ||
          row.typeName ||
          row.vehicleTypeName ||
          '';
        if (rawType && String(rawType).trim()) {
          const foundType = await resolveVehicleType(rawType);
          if (foundType) {
            vehicleTypeId = foundType._id;
          }
        }

        const rawDriver =
          row.driverId ||
          row.driver ||
          row.driverName ||
          row.vehicleDriver ||
          row.driverFullName ||
          '';

        if (rawDriver && String(rawDriver).trim()) {
          const foundDriver = await resolveDriver(rawDriver);
          if (foundDriver) {
            driverId = foundDriver._id;
          }
        }

        await Vehicle.create({
          owner: ownerId,
          vehicleType: vehicleTypeId,
          driver: driverId,
          vehicleNumber: cleanVehicleNumber,
          governorate: cleanGovernorate,
          capacity: normalizedCapacity,
          annualExpiry: row.annualExpiry || null,
          calibrationExpiry: row.calibrationExpiry || null,
          ...keys,
          createdBy: req.user._id,
        });

        results.success++;
      } catch (err) {
        results.failed++;
        const reason = err?.errors
          ? Object.values(err.errors).map((e) => e.message).join(', ')
          : err.message || 'خطأ غير معروف';
        results.errors.push(`"${row.vehicleNumber || 'بدون رقم'}" — ${reason}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== PUT update =====
router.put('/:id', protect, canAccess, imgFields, async (req, res) => {
  try {
    const {
      owner,
      vehicleType,
      driver,
      vehicleNumber,
      governorate,
      capacity,
      annualExpiry,
      calibrationExpiry,
    } = req.body;

    if (!vehicleType) {
      return res.status(400).json({ message: 'نوع المركبة مطلوب' });
    }

    if (!vehicleNumber?.trim()) {
      return res.status(400).json({ message: 'رقم المركبة مطلوب' });
    }

    const normalizedCapacity = normalizeCapacity(capacity);
    if (normalizedCapacity === 'INVALID') {
      return res.status(400).json({
        message: 'حمولة المركبة يجب أن تكون رقماً صحيحاً من خمس مراتب كحد أقصى',
      });
    }

    let foundOwner = null;
    if (owner && String(owner).trim()) {
      foundOwner = await resolveOwner(owner);
    }

    const foundType = await resolveVehicleType(vehicleType);
    if (!foundType) {
      return res.status(400).json({ message: 'نوع المركبة غير موجود' });
    }

    let foundDriver = null;
    if (driver && String(driver).trim()) {
      foundDriver = await resolveDriver(driver);
      if (!foundDriver) {
        return res.status(400).json({ message: 'سائق المركبة غير موجود' });
      }
    }

    const cleanVehicleNumber = normalizeVehicleNumber(vehicleNumber);
    const cleanGovernorate = String(governorate || '').trim();
    const keys = makeKeys(cleanVehicleNumber, cleanGovernorate);
    const imgs = getImagePaths(req.files);

    const old = await Vehicle.findById(req.params.id);
    if (!old) {
      return res.status(404).json({ message: 'المركبة غير موجودة' });
    }

    const update = {
      owner: foundOwner?._id || null,
      vehicleType: foundType._id,
      driver: foundDriver?._id || null,
      vehicleNumber: cleanVehicleNumber,
      governorate: cleanGovernorate,
      capacity: normalizedCapacity,
      annualExpiry: annualExpiry || null,
      calibrationExpiry: calibrationExpiry || null,
      ...keys,
    };

    if (imgs.annualImage) {
      deleteOldImage(old.annualImage);
      update.annualImage = imgs.annualImage;
    }

    if (imgs.calibrationImage) {
      deleteOldImage(old.calibrationImage);
      update.calibrationImage = imgs.calibrationImage;
    }

    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    })
      .populate('owner', 'name')
      .populate('vehicleType', 'name')
      .populate('driver', 'name');

    res.json(vehicle);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: duplicateMessage(req.body.vehicleNumber, req.body.governorate),
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// ===== DELETE bulk =====
router.delete('/bulk', protect, canAccess, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'لم يتم تحديد أي سجلات' });
    }

    const vehicles = await Vehicle.find({ _id: { $in: ids } });
    vehicles.forEach((v) => {
      deleteOldImage(v.annualImage);
      deleteOldImage(v.calibrationImage);
    });

    const result = await Vehicle.deleteMany({ _id: { $in: ids } });

    res.json({
      message: `تم حذف ${result.deletedCount} مركبة بنجاح`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== DELETE single =====
router.delete('/:id', protect, canAccess, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'المركبة غير موجودة' });

    deleteOldImage(vehicle.annualImage);
    deleteOldImage(vehicle.calibrationImage);

    res.json({ message: 'تم حذف المركبة بنجاح' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;