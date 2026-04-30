const express = require('express');
const multer = require('multer');
const router = express.Router();

const { protect } = require('../middleware/auth');
const unloadingRecordController = require('../controllers/unloadingRecord.controller');

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('forms')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* =========================
   Existing Routes
========================= */

router.get(
  '/',
  protect,
  canAccess,
  unloadingRecordController.listUnloadingRecords
);

router.post(
  '/extract',
  protect,
  canAccess,
  upload.single('image'),
  unloadingRecordController.extractUnloadingRecordFromImage
);

router.post(
  '/save',
  protect,
  canAccess,
  unloadingRecordController.saveUnloadingRecord
);

/* =========================
   NEW ROUTE (IMPORTANT)
   جلب الوصولات آخر 34 ساعة
========================= */

router.get(
  '/recent-receipts',
  protect,
  canAccess,
  unloadingRecordController.listRecentUnloadingReceipts
);

module.exports = router;