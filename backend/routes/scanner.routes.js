const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { listWiaDevices, scanDocumentImage } = require('../services/windowsScanner');

router.get('/devices', protect, async (_req, res) => {
  try {
    const result = await listWiaDevices();
    res.json({
      success: true,
      available: Boolean(result.success),
      devices: Array.isArray(result.devices) ? result.devices : [],
      scannerCount: Number(result.scannerCount || 0),
      message: result.success ? '' : (result.error || 'لم يتمكن ويندوز من الوصول إلى WIA على هذا الجهاز'),
      detail: result.error || '',
    });
  } catch (error) {
    res.json({
      success: true,
      available: false,
      devices: [],
      scannerCount: 0,
      message: String(error?.message || 'تعذر جلب أجهزة السكانر من ويندوز'),
      detail: String(error?.message || error),
    });
  }
});

router.post('/scan', protect, async (_req, res) => {
  try {
    const mode = String(_req.body?.mode || _req.query?.mode || 'fast').toLowerCase();
    const result = await scanDocumentImage({ mode });
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = String(error?.message || '');
    console.error('[scanner/scan] failed:', error);

    if (message.includes('SCAN_CANCELLED')) {
      return res.status(400).json({ message: 'تم إلغاء عملية السحب من السكانر' });
    }

    if (message.includes('SCAN_TIMEOUT')) {
      return res.status(504).json({
        message: 'لم يستجب السكانر خلال الوقت المحدد. تأكد أن نافذة السكانر ظهرت ثم أعد المحاولة.',
      });
    }

    if (message.includes('NO_WIA_SCANNER_FOUND')) {
      return res.status(400).json({
        message: 'لم يتم العثور على سكانر WIA في ويندوز. تأكد من تعريف الجهاز وأنه يظهر في Windows Fax and Scan.',
      });
    }

    if (message.includes('NO_PAGES_IN_FEEDER')) {
      return res.status(400).json({
        message: 'لا توجد صفحات داخل المغذي. تأكد من إدخال الورق ثم أعد المحاولة.',
        detail: message,
      });
    }

    if (message.includes('NAPS2_SCAN_FAILED')) {
      return res.status(502).json({
        message: 'فشل NAPS2 أثناء السحب من السكانر.',
        detail: message,
      });
    }

    res.status(500).json({
      message: 'تعذر تشغيل السكانر أو لم يتم العثور على جهاز متصل',
      detail: message,
    });
  }
});

module.exports = router;
