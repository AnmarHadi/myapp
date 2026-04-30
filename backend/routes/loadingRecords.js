const express = require('express');
const multer = require('multer');
const router = express.Router();

const { protect } = require('../middleware/auth');
const unloadingRecordController = require('../controllers/unloadingRecord.controller');

const forceLoadingMode = (req, _res, next) => {
  req.registrationMode = 'loading';
  next();
};

const canAccess = (req, res, next) => {
  if (req.user.isAdmin || req.user.permissions?.includes('forms')) return next();
  return res.status(403).json({ message: 'ليس لديك صلاحية الوصول' });
};

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/', protect, canAccess, forceLoadingMode, unloadingRecordController.listUnloadingRecords);
router.post('/extract', protect, canAccess, forceLoadingMode, upload.single('image'), unloadingRecordController.extractUnloadingRecordFromImage);
router.post('/save', protect, canAccess, forceLoadingMode, unloadingRecordController.saveUnloadingRecord);
router.get('/recent-receipts', protect, canAccess, forceLoadingMode, unloadingRecordController.listRecentUnloadingReceipts);

module.exports = router;
