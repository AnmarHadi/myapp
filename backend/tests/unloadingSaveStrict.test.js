const test = require('node:test');
const assert = require('node:assert/strict');

const controller = require('../controllers/unloadingRecord.controller');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('save rejects when strictChecks are missing', async () => {
  const req = {
    body: {
      documentNumber: 'A12345678',
    },
    user: { _id: 'u1' },
  };
  const res = createRes();

  await controller.saveUnloadingRecord(req, res);

  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(res.body?.blockingErrors));
  assert.ok(res.body.blockingErrors.length > 0);
});

test('save proceeds past strict gate when strictChecks are confirmed', async () => {
  const req = {
    body: {
      documentNumber: 'INVALID',
      strictChecks: {
        vehicleNumber: { status: 'confirmed', reasonCodes: [] },
        driverName: { status: 'confirmed', reasonCodes: [] },
        loadingWarehouseName: { status: 'confirmed', reasonCodes: [] },
      },
    },
    user: { _id: 'u1' },
  };
  const res = createRes();

  await controller.saveUnloadingRecord(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.blockingErrors, undefined);
});

