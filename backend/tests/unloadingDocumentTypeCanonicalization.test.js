const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { canonicalDocumentType } = require('../services/unloadingFieldReader');
const { runEasyOcr } = require('../services/unloadingEasyOcrBridge');

test('canonicalDocumentType normalizes known values to fixed canonical set', () => {
  const cases = [
    ['68', '68ج'],
    ['68ج', '68ج'],
    ['68 ج', '68ج'],
    ['68c', '68ج'],
    ['126 تصدير', '126 تصديري'],
    ['126 تصديري', '126 تصديري'],
    ['68a', '68ا'],
    ['68b', '68ب'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(
      canonicalDocumentType(input),
      expected,
      `Expected "${input}" -> "${expected}"`
    );
  }
});

test('canonicalDocumentType returns one of allowed final values when recognized', () => {
  const allowed = new Set(['68ا', '68ب', '68ج', '126 تصديري']);
  const recognized = [
    '68',
    '68ا',
    '68ب',
    '68ج',
    '68a',
    '68b',
    '68c',
    '126 تصدير',
    '126 تصديري',
  ];

  for (const value of recognized) {
    const normalized = canonicalDocumentType(value);
    assert.ok(allowed.has(normalized), `Unexpected canonical value for "${value}": "${normalized}"`);
  }
});

test('integration (optional): OCR on 41.jpg yields canonical documentType 68ج', async (t) => {
  if (process.env.RUN_OCR_INTEGRATION !== '1') {
    t.skip('Set RUN_OCR_INTEGRATION=1 to run OCR integration test.');
    return;
  }

  const imagePath = process.env.UNLOADING_TEST_IMAGE_41 || 'C:/Users/hp/Desktop/مستندات/41.jpg';
  if (!fs.existsSync(imagePath)) {
    t.skip(`Image not found: ${imagePath}`);
    return;
  }

  const extracted = await runEasyOcr(imagePath);
  const normalized = canonicalDocumentType(extracted?.documentType || '');
  assert.equal(normalized, '68ج');
});

