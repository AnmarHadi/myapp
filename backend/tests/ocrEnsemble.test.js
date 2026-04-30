const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeAttempts, qualityScore, runOcrEnsemble } = require('../services/ocrEnsemble');

test('qualityScore rewards complete OCR results', () => {
  const rich = qualityScore({
    documentNumber: 'A12345678',
    documentType: '68ج',
    issueDate: '2026-04-19',
    receiverEntity: 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد',
    vehicleNumber: '22E410464',
    driverName: 'محمد كاظم شرار الجاسمي',
    loadingWarehouseName: 'مصفى الناصرية',
    suppliedQuantityLiters: 36000,
    ocrMatches: { vehicle: {}, driver: {} },
  });

  const poor = qualityScore({
    documentNumber: '',
    vehicleNumber: '',
    driverName: 'محمد',
    loadingWarehouseName: '',
    suppliedQuantityLiters: 0,
    ocrMatches: {},
  });

  assert.ok(rich > poor);
});

test('mergeAttempts keeps best field across attempts', () => {
  const merged = mergeAttempts([
    {
      success: true,
      documentNumber: '',
      loadingWarehouseName: 'مصفى الناصرية',
      vehicleNumberRaw: '410464/22E',
      vehicleNumber: '22E410464',
      driverName: 'محمد',
      suppliedQuantityLiters: 0,
      ocrMatches: {},
      meta: { ensembleScore: 4.2 },
    },
    {
      success: true,
      documentNumber: 'A12345678',
      loadingWarehouseName: '',
      vehicleNumberRaw: '',
      vehicleNumber: '',
      driverName: 'محمد كاظم شرار الجاسمي',
      suppliedQuantityLiters: 36000,
      ocrMatches: {},
      meta: { ensembleScore: 7.8 },
    },
  ]);

  assert.equal(merged.documentNumber, 'A12345678');
  assert.equal(merged.vehicleNumber, '22E410464');
  assert.ok(merged.driverName.includes('محمد كاظم شرار'));
  assert.equal(merged.loadingWarehouseName, 'مصفى الناصرية');
  assert.equal(merged.suppliedQuantityLiters, 36000);
  assert.equal(merged.meta.ensemble.bestAttemptIndex, 2);
});

test('runOcrEnsemble retries profiles and merges successful output', async () => {
  const calls = [];
  const runner = async (_imagePath, _templateName, profile) => {
    calls.push(profile.profileName);
    if (profile.profileName === 'default') {
      throw new Error('default failed');
    }

    if (profile.profileName === 'detail') {
      return {
        success: true,
        documentNumber: 'A12345678',
        issueDate: '2026-04-19',
        vehicleNumber: '22E410464',
        driverName: 'محمد كاظم شرار الجاسمي',
        loadingWarehouseName: 'مصفى الناصرية',
        meta: { durationMs: 120 },
      };
    }

    return {
      success: true,
      meta: { durationMs: 110 },
    };
  };

  const result = await runOcrEnsemble({
    imagePath: 'fake-image.png',
    mode: 'retry_fast',
    runner,
  });

  assert.deepEqual(calls, ['default', 'detail']);
  assert.equal(result.vehicleNumber, '22E410464');
  assert.equal(result.documentNumber, 'A12345678');
  assert.equal(result.issueDate, '2026-04-19');
  assert.ok(result.driverName.includes('محمد كاظم شرار'));
  assert.equal(result.meta.ensemble.attemptsCount, 2);
});
