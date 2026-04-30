const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeVisionReviews } = require('../services/visionReviewMerger');

test('mergeVisionReviews combines strongest fields across reviews', () => {
  const merged = mergeVisionReviews([
    {
      available: true,
      success: true,
      source: 'google_document_ai',
      score: 6,
      fields: {
        documentNumber: 'A12345678',
        documentType: '90',
        issueDate: '2026-04-19',
        loadingWarehouseName: 'Company A',
        receiverEntity: 'South Refinery',
        vehicleNumber: '21H51624',
        driverName: 'Ahmed Ali',
        productType: 'oil',
        suppliedQuantityLiters: '28840',
        fieldConfidence: {
          vehicleNumber: 0.95,
          driverName: 0.2,
          loadingWarehouseName: 0.9,
          receiverEntity: 0.92,
        },
      },
      topCandidates: {
        driverName: [{ value: 'Ahmed Ali', confidence: 0.2, valid: false }],
      },
      attempts: [{ attempt: 1, success: true, score: 6 }],
    },
    {
      available: true,
      success: true,
      source: 'vision',
      score: 8,
      fields: {
        documentNumber: '',
        documentType: '',
        issueDate: '2026-04-19',
        loadingWarehouseName: 'Company A',
        receiverEntity: 'South Refinery',
        vehicleNumber: '21H51624',
        driverName: 'Ismail Aswad Ali',
        productType: 'oil',
        suppliedQuantityLiters: '28840',
        fieldConfidence: {
          vehicleNumber: 0.55,
          driverName: 0.91,
          loadingWarehouseName: 0.6,
          receiverEntity: 0.65,
        },
      },
      topCandidates: {
        driverName: [{ value: 'Ismail Aswad Ali', confidence: 0.91, valid: true }],
      },
      attempts: [{ attempt: 1, success: true, score: 8 }],
    },
  ], { registrationMode: 'loading' });

  assert.equal(merged.fields.documentNumber, 'A12345678');
  assert.equal(merged.fields.documentType, '90');
  assert.equal(merged.fields.issueDate, '2026-04-19');
  assert.equal(merged.fields.loadingWarehouseName, 'Company A');
  assert.equal(merged.fields.receiverEntity, 'South Refinery');
  assert.equal(merged.fields.vehicleNumber, '21H51624');
  assert.ok(merged.fields.driverName.includes('Aswad'));
  assert.equal(merged.fields.productType, 'oil');
  assert.equal(merged.fields.suppliedQuantityLiters, '28840');
  assert.ok(merged.fields.fieldConfidence.driverName > 0.2);
  assert.equal(merged.source, 'google_document_ai');
});
