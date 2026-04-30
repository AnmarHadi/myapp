const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalVehicleValue,
  sanitizeDriverForStrict,
  sanitizeWarehouseStrictValue,
  normalizeWarehouseCandidate,
  buildUnloadingStrictChecks,
} = require('../services/unloadingStrictChecks');

test('canonical vehicle format: 410464/22E -> 22E410464', () => {
  assert.equal(canonicalVehicleValue('410464/22E'), '22E410464');
});

test('malformed vehicle number becomes review_required', () => {
  const strict = buildUnloadingStrictChecks({
    values: {
      vehicleNumber: '04641',
      driverName: 'محمد كاظم شذر الجاسمي',
      loadingWarehouseName: 'مصفى الناصرية',
    },
    entities: {
      loadingWarehouse: { _id: 'w1', name: 'مصفى الناصرية' },
      driver: { _id: 'd1', name: 'محمد كاظم شذر الجاسمي' },
      vehicle: null,
    },
    warehouseWhitelist: [{ _id: 'w1', name: 'مصفى الناصرية' }],
    options: { forSave: true },
  });

  assert.equal(strict.strictChecks.vehicleNumber.status, 'review_required');
  assert.ok(strict.strictChecks.vehicleNumber.reasonCodes.includes('vehicle_pattern_invalid'));
});

test('warehouse sanitization strips noisy token الاصدار and confirms whitelist hit', () => {
  const noisy = 'مصفى الناصرية الاصدار';
  const sanitized = sanitizeWarehouseStrictValue(normalizeWarehouseCandidate(noisy));
  assert.equal(sanitized, 'مصفى الناصرية');

  const strict = buildUnloadingStrictChecks({
    values: {
      vehicleNumber: '22E410464',
      driverName: 'محمد كاظم شذر الجاسمي',
      loadingWarehouseName: noisy,
    },
    entities: {
      loadingWarehouse: { _id: 'w1', name: 'مصفى الناصرية' },
      driver: { _id: 'd1', name: 'محمد كاظم شذر الجاسمي' },
      vehicle: { _id: 'v1', vehicleNumber: '410464/22E' },
    },
    warehouseWhitelist: [{ _id: 'w1', name: 'مصفى الناصرية' }],
    options: { forSave: true },
  });

  assert.equal(strict.strictChecks.loadingWarehouseName.value, 'مصفى الناصرية');
  assert.equal(strict.strictChecks.loadingWarehouseName.status, 'confirmed');
});

test('driver cross-line pollution is flagged', () => {
  const polluted = 'محمد كاظم شذر الجاسمي تاريخ الهوية 2024-01-01';
  const sanitized = sanitizeDriverForStrict(polluted);
  assert.ok(sanitized.includes('محمد'));

  const strict = buildUnloadingStrictChecks({
    values: {
      vehicleNumber: '22E410464',
      driverName: polluted,
      loadingWarehouseName: 'مصفى الناصرية',
    },
    entities: {
      loadingWarehouse: { _id: 'w1', name: 'مصفى الناصرية' },
      driver: { _id: 'd1', name: 'محمد كاظم شذر الجاسمي' },
      vehicle: { _id: 'v1', vehicleNumber: '410464/22E' },
    },
    warehouseWhitelist: [{ _id: 'w1', name: 'مصفى الناصرية' }],
    options: { forSave: true },
  });

  assert.equal(strict.strictChecks.driverName.status, 'review_required');
  assert.ok(strict.strictChecks.driverName.reasonCodes.includes('cross_line_pollution'));
});
