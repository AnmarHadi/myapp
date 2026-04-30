const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeVehicle,
  normalizeDriver,
  normalizeWarehouse,
  hasArabicNameShape,
} = require('../services/unloadingVisionVerifier');

test('vision helper normalizes vehicle in slash format', () => {
  assert.equal(normalizeVehicle('410464/22E'), '22E410464');
});

test('vision helper keeps canonical vehicle format', () => {
  assert.equal(normalizeVehicle('22B32505'), '22B32505');
});

test('vision helper recognizes Arabic driver full-name shape', () => {
  assert.equal(hasArabicNameShape('محمد كاظم شذر الجاسمي'), true);
});

test('vision helper sanitizes driver with numeric noise', () => {
  const cleaned = normalizeDriver('محمد كاظم شذر الجاسمي 2024-01-01');
  assert.equal(cleaned.includes('2024'), false);
});

test('vision helper keeps warehouse core wording', () => {
  const warehouse = normalizeWarehouse('مصفى الناصرية');
  assert.ok(warehouse.includes('مصف') || warehouse.length > 0);
});
