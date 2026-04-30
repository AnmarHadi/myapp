const fs = require('fs');
const path = require('path');

const { runEasyOcr } = require('../services/unloadingEasyOcrBridge');
const {
  canonicalVehicleValue,
  sanitizeDriverForStrict,
  sanitizeWarehouseStrictValue,
} = require('../services/unloadingStrictChecks');

const datasetPath = path.resolve(__dirname, 'fixtures', 'unloading-regression.expected.json');
const projectRoot = path.resolve(__dirname, '..', '..');

function normalizeWarehouse(value = '') {
  return sanitizeWarehouseStrictValue(value);
}

async function run() {
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const dataset = JSON.parse(raw);
  const rows = Array.isArray(dataset.cases) ? dataset.cases : [];

  let failures = 0;
  let executed = 0;
  let skipped = 0;

  for (const row of rows) {
    const imagePath = path.resolve(projectRoot, row.image);
    const required = row.required !== false;

    if (!fs.existsSync(imagePath)) {
      if (required) {
        failures += 1;
        console.error(`[FAIL] ${row.name}: image not found -> ${imagePath}`);
      } else {
        skipped += 1;
        console.log(`[SKIP] ${row.name}: optional image not found -> ${imagePath}`);
      }
      continue;
    }

    executed += 1;
    const extracted = await runEasyOcr(imagePath);

    const actual = {
      vehicleNumber: canonicalVehicleValue(extracted.vehicleNumber || extracted.vehicleNumberRaw || ''),
      driverName: sanitizeDriverForStrict(extracted.driverName || ''),
      loadingWarehouseName: normalizeWarehouse(extracted.loadingWarehouseName || ''),
    };

    const expected = row.expected || {};
    const mismatches = [];

    for (const key of Object.keys(expected)) {
      if ((actual[key] || '') !== (expected[key] || '')) {
        mismatches.push({
          field: key,
          expected: expected[key] || '',
          actual: actual[key] || '',
        });
      }
    }

    if (mismatches.length) {
      failures += 1;
      console.error(`[FAIL] ${row.name}`);
      for (const mismatch of mismatches) {
        console.error(`  - ${mismatch.field}: expected="${mismatch.expected}" actual="${mismatch.actual}"`);
      }
    } else {
      console.log(`[PASS] ${row.name}`);
    }
  }

  console.log(`\nSummary -> executed: ${executed}, skipped: ${skipped}, failures: ${failures}`);

  if (failures > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('Regression runner failed:', error.message);
  process.exit(1);
});
