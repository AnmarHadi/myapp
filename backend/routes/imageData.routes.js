const express = require('express');
const router = express.Router();
const multer = require('multer');
const imageDataController = require('../controllers/imageData.controller');
const { protect } = require('../middleware/auth');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('الملف المرسل ليس صورة'));
    }
    cb(null, true);
  },
});

router.post(
  '/extract',
  protect,
  upload.single('image'),
  imageDataController.extractImageData
);

router.post(
  '/save',
  protect,
  imageDataController.saveImageData
);

module.exports = router;