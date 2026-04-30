const {
  canonicalVehicleValue,
  sanitizeWarehouseStrictValue,
} = require('./unloadingStrictChecks');
const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName,
  cleanValue,
} = require('./unloadingFieldReader');
const { isGoldenRefinery, repairBrokenWords } = require('./arabicFuzzy');

const GEMINI_MODEL = process.env.UNLOADING_GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CANONICAL_RECEIVER =
  '\u0645\u0639\u0645\u0644 \u0645\u0635\u0641\u0649 \u0627\u0644\u0646\u0641\u0637 \u0627\u0644\u0630\u0647\u0628\u064a \u0644\u0625\u0646\u062a\u0627\u062c \u0627\u0644\u0627\u0633\u0641\u0644\u062a \u0627\u0644\u0645\u0624\u0643\u0633\u062f';

function cleanString(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function parseJsonSafe(text = '') {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Some model responses wrap JSON in prose; recover the first object.
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
  return null;
}

function extractFirstJson(payload = {}) {
  for (const candidate of payload.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === 'string') {
        const parsed = parseJsonSafe(part.text);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

function extractText(payload = {}) {
  for (const candidate of payload.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return '';
}

function normalizeQuantity(value = '') {
  const western = String(value || '').replace(/[\u0660-\u0669]/g, (digit) => (
    '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(digit).toString()
  ));
  const values = (western.match(/\d{3,6}/g) || [])
    .map(Number)
    .filter((item) => Number.isFinite(item) && item >= 1000 && item <= 60000);
  return values.length ? String(values.sort((a, b) => b - a)[0]) : '';
}

function normalizeReceiverEntity(value = '', registrationMode = 'unloading') {
  const receiverRaw = repairBrokenWords(cleanString(value));
  if (registrationMode === 'loading') return receiverRaw;

  return isGoldenRefinery(receiverRaw)
    ? (canonicalReceiverEntity(receiverRaw, '') || CANONICAL_RECEIVER)
    : receiverRaw;
}

function normalizeFields(raw = {}, registrationMode = 'unloading') {
  return {
    documentNumber: normalizeDocumentNumber(raw.documentNumber || '') || '',
    documentType: canonicalDocumentType(raw.documentType || '') || '',
    issueDate: normalizeDateValue(raw.issueDate || '') || '',
    loadingWarehouseName: sanitizeWarehouseName(
      sanitizeWarehouseStrictValue(raw.loadingWarehouseName || '')
    ),
    receiverEntity: normalizeReceiverEntity(raw.receiverEntity || '', registrationMode),
    vehicleNumber: canonicalVehicleValue(raw.vehicleNumber || ''),
    driverName: sanitizeDriverName(raw.driverName || ''),
    productType: cleanValue(raw.productType || ''),
    suppliedQuantityLiters: normalizeQuantity(raw.suppliedQuantityLiters || ''),
    rawText: cleanString(raw.rawText || ''),
    fieldConfidence: {
      documentNumber: clamp01(raw.fieldConfidence?.documentNumber, 0.6),
      documentType: clamp01(raw.fieldConfidence?.documentType, 0.6),
      issueDate: clamp01(raw.fieldConfidence?.issueDate, 0.6),
      loadingWarehouseName: clamp01(raw.fieldConfidence?.loadingWarehouseName, 0.6),
      receiverEntity: clamp01(raw.fieldConfidence?.receiverEntity, 0.6),
      vehicleNumber: clamp01(raw.fieldConfidence?.vehicleNumber, 0.6),
      driverName: clamp01(raw.fieldConfidence?.driverName, 0.55),
      productType: clamp01(raw.fieldConfidence?.productType, 0.55),
      suppliedQuantityLiters: clamp01(raw.fieldConfidence?.suppliedQuantityLiters, 0.6),
    },
  };
}

function buildScore(fields = {}, registrationMode = 'unloading') {
  let score = 0;
  if (fields.documentNumber) score += 6;
  if (fields.documentType) score += 5;
  if (fields.issueDate) score += 4;
  if (fields.loadingWarehouseName) score += 5;
  if (fields.receiverEntity) score += 6;
  if (fields.vehicleNumber) score += 6;
  if (fields.driverName) score += 4;
  if (registrationMode === 'loading' && fields.productType) score += 4;
  if (fields.suppliedQuantityLiters) score += 2;
  score += Object.values(fields.fieldConfidence || {}).reduce(
    (sum, value) => sum + clamp01(value, 0),
    0
  );
  return Number(score.toFixed(3));
}

function buildJsonSchema() {
  const stringProp = { type: 'STRING' };
  const numberProp = { type: 'NUMBER' };
  const confidenceProperties = {
    documentNumber: numberProp,
    documentType: numberProp,
    issueDate: numberProp,
    loadingWarehouseName: numberProp,
    receiverEntity: numberProp,
    vehicleNumber: numberProp,
    driverName: numberProp,
    productType: numberProp,
    suppliedQuantityLiters: numberProp,
  };

  return {
    type: 'OBJECT',
    properties: {
      documentNumber: stringProp,
      documentType: stringProp,
      issueDate: stringProp,
      loadingWarehouseName: stringProp,
      receiverEntity: stringProp,
      vehicleNumber: stringProp,
      driverName: stringProp,
      productType: stringProp,
      suppliedQuantityLiters: stringProp,
      rawText: stringProp,
      fieldConfidence: {
        type: 'OBJECT',
        properties: confidenceProperties,
        required: Object.keys(confidenceProperties),
      },
    },
    required: [
      'documentNumber',
      'documentType',
      'issueDate',
      'loadingWarehouseName',
      'receiverEntity',
      'vehicleNumber',
      'driverName',
      'productType',
      'suppliedQuantityLiters',
      'rawText',
      'fieldConfidence',
    ],
  };
}

function buildRawTextPrompt(registrationMode = 'unloading') {
  if (registrationMode === 'loading') {
    return `Read this Iraqi OPDC loading document image and transcribe all visible text accurately.
Keep Arabic names exactly as written and convert Arabic-Indic digits to English digits.
Important loading-document clues:
- The document number is usually near the top-left and may start with E, for example E0041474.
- The document may say "استمارة نقل 90" or "مستند تحميل منتجات معامل".
- Read the upper information table, the product table, vehicle number, driver name, quantity, and loading date.
- Preserve the raw wording for warehouse/source and receiver/destination.`;
  }

  return `Read this Iraqi OPDC unloading document image and transcribe all visible text accurately.
Keep Arabic names exactly as written and convert Arabic-Indic digits to English digits.
Important unloading-document clues:
- The document number is usually under the OPDC logo and may start with A, for example A28193322.
- The geometric shape near QR/logo can identify document type 68ا, 68ب, 68ج, or 126 تصديري.
- Read the upper information table, vehicle number, driver name, quantity, and issue date.`;
}

function buildFieldPrompt(rawText = '', registrationMode = 'unloading') {
  if (registrationMode === 'loading') {
    return `Extract structured fields from this Iraqi OPDC LOADING document.

Raw text:
${rawText}

Return JSON only. Field rules:
- documentNumber: top-left document number, usually one English letter plus 7 or 8 digits, for example E0041474.
- documentType: use "90" if the document says "استمارة نقل 90"; otherwise use the visible canonical document type if present.
- issueDate: use the loading date / "وقت وتاريخ التحميل" as YYYY-MM-DD when no separate issue date exists.
- loadingWarehouseName: the source/seller/factory in the upper right table, for example "شركة الشبكة النفطية".
- receiverEntity: the destination/customer/recipient in the upper table, for example "البصرة / خور الزبير".
- vehicleNumber: exact visible vehicle number, for example "11H 12179" or "17668/21B".
- driverName: driver name from the "اسم السائق" row in the upper vehicle information table. Do not use supervisor, stamp, signature, or employee names.
- productType: value under "نوع المنتوج", for example "اسفلت مؤكسد 60/70".
- suppliedQuantityLiters: numeric loaded quantity in liters from the product table, for example 32060.
- rawText: the complete useful text from the image.
- fieldConfidence: confidence for each field from 0 to 1.`;
  }

  return `Extract structured fields from this Iraqi OPDC UNLOADING document.

Raw text:
${rawText}

Return JSON only. Field rules:
- documentNumber: document number, usually A plus 8 digits, for example A28193322.
- documentType: exactly one of "68ا", "68ب", "68ج", or "126 تصديري" when visible.
- issueDate: issue date as YYYY-MM-DD.
- loadingWarehouseName: supplier/source from the upper table only.
- receiverEntity: recipient/destination from the upper table only.
- vehicleNumber: exact visible vehicle number.
- driverName: driver name only; do not use supervisor, stamp, signature, or employee names.
- productType: return an empty string if no product type is visible.
- suppliedQuantityLiters: numeric quantity in liters from the product table.
- rawText: the complete useful text from the image.
- fieldConfidence: confidence for each field from 0 to 1.`;
}

async function postGemini({ apiKey, body }) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status}${text ? ` ${text}` : ''}`);
  }

  return response.json();
}

async function extractRawText({
  imageBuffer,
  mimeType,
  apiKey,
  registrationMode = 'unloading',
}) {
  const payload = await postGemini({
    apiKey,
    body: {
      systemInstruction: {
        parts: [{
          text: 'You are an expert OCR and vision reader for Iraqi OPDC oil documents. Preserve numbers, Arabic names, and table relationships.',
        }],
      },
      contents: [{
        role: 'user',
        parts: [
          { text: buildRawTextPrompt(registrationMode) },
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      }],
      generationConfig: { temperature: 0 },
    },
  });

  return extractText(payload);
}

async function extractFieldsFromText({
  rawText,
  imageBuffer,
  mimeType,
  apiKey,
  registrationMode = 'unloading',
}) {
  const parts = [{ text: buildFieldPrompt(rawText, registrationMode) }];
  if (imageBuffer) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBuffer.toString('base64'),
      },
    });
  }

  const payload = await postGemini({
    apiKey,
    body: {
      systemInstruction: {
        parts: [{
          text: 'You extract Iraqi oil document fields. Return valid JSON only and never add prose.',
        }],
      },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: buildJsonSchema(),
      },
    },
  });

  return extractFirstJson(payload);
}

async function runUnloadingGeminiReview({
  imageBuffer,
  mimeType,
  registrationMode = 'unloading',
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      success: false,
      message: 'GEMINI_API_KEY is missing',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
      source: 'gemini_document_ai',
    };
  }

  let rawText = '';
  try {
    rawText = await extractRawText({
      imageBuffer,
      mimeType,
      apiKey,
      registrationMode,
    });
  } catch (error) {
    console.warn(
      '[GeminiExtractor] pass1 failed, falling back to pass2 only:',
      error.message
    );
  }

  let parsed = null;
  try {
    parsed = await extractFieldsFromText({
      rawText,
      imageBuffer,
      mimeType,
      apiKey,
      registrationMode,
    });
  } catch (error) {
    return {
      available: true,
      success: false,
      message: `Gemini field extraction failed: ${error.message}`,
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: GEMINI_MODEL,
      source: 'gemini_document_ai',
    };
  }

  if (!parsed) {
    return {
      available: true,
      success: false,
      message: 'Could not parse Gemini response',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: GEMINI_MODEL,
      source: 'gemini_document_ai',
    };
  }

  if (!rawText && parsed.rawText) rawText = parsed.rawText;
  parsed.rawText = rawText || parsed.rawText || '';

  const fields = normalizeFields(parsed, registrationMode);
  const score = buildScore(fields, registrationMode);

  if (score < 20 && rawText) {
    try {
      const retryParsed = await extractFieldsFromText({
        rawText,
        imageBuffer: null,
        mimeType,
        apiKey,
        registrationMode,
      });
      if (retryParsed) {
        retryParsed.rawText = rawText;
        const retryFields = normalizeFields(retryParsed, registrationMode);
        const retryScore = buildScore(retryFields, registrationMode);
        if (retryScore > score) {
          return {
            available: true,
            success: true,
            message: '',
            fields: retryFields,
            attempts: [
              { attempt: 1, success: true, score },
              { attempt: 2, success: true, score: retryScore },
            ],
            bestAttempt: 2,
            score: retryScore,
            topCandidates: {},
            model: GEMINI_MODEL,
            source: 'gemini_document_ai',
          };
        }
      }
    } catch (_) {
      // Keep the first successful structured result.
    }
  }

  return {
    available: true,
    success: true,
    message: '',
    fields,
    attempts: [{ attempt: 1, success: true, score }],
    bestAttempt: 1,
    score,
    topCandidates: {},
    model: GEMINI_MODEL,
    source: 'gemini_document_ai',
  };
}

module.exports = { runUnloadingGeminiReview };
