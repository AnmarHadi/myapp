const Groq = require('groq-sdk');
const {
  canonicalVehicleValue,
  sanitizeWarehouseStrictValue,
} = require('./unloadingStrictChecks');
const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  sanitizeDriverName,
  cleanValue,
} = require('./unloadingFieldReader');

const DEFAULT_MODEL = process.env.UNLOADING_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_ATTEMPTS = Number(process.env.UNLOADING_VISION_ATTEMPTS || 3);
const VEHICLE_PATTERN = /^\d{2}[A-Z]\d{4,6}$/;
const WAREHOUSE_PATTERN = /(?:\u0645\u0633\u062a\u0648\u062f\u0639|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629)/;
const ARABIC_TOKEN_PATTERN = /^[\u0621-\u064A]{2,}$/;

let cachedClient = null;

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return cachedClient;
}

function parseJsonPayload(content = '') {
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch (_) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }

  return null;
}

function cleanString(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toWesternDigits(value = '') {
  const map = {
    '\u0660': '0',
    '\u0661': '1',
    '\u0662': '2',
    '\u0663': '3',
    '\u0664': '4',
    '\u0665': '5',
    '\u0666': '6',
    '\u0667': '7',
    '\u0668': '8',
    '\u0669': '9',
  };
  return String(value || '').replace(/[\u0660-\u0669]/g, (d) => map[d] || d);
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) {
    const percent = number / 100;
    return Math.max(0, Math.min(1, percent));
  }
  return Math.max(0, Math.min(1, number));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function pushUniqueCandidate(store, value, confidence) {
  const cleaned = cleanString(value);
  if (!cleaned) return;
  const key = cleaned.toLowerCase();
  const prev = store.get(key);
  const nextConfidence = clamp01(confidence, 0.5);
  if (!prev || nextConfidence > prev.confidence) {
    store.set(key, {
      value: cleaned,
      confidence: Number(nextConfidence.toFixed(3)),
    });
  }
}

function normalizeVehicle(value = '') {
  return canonicalVehicleValue(value || '');
}

function normalizeDriver(value = '') {
  return sanitizeDriverName(value || '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWarehouse(value = '') {
  return sanitizeWarehouseStrictValue(value || '');
}

function normalizeQuantity(value = '') {
  const matches = toWesternDigits(String(value || '')).match(/\d{3,6}/g) || [];
  const list = matches
    .map((item) => Number(item))
    .filter((number) => Number.isFinite(number) && number >= 1000 && number <= 60000);
  if (!list.length) return '';
  return String(list.sort((a, b) => b - a)[0]);
}

function normalizeProductType(value = '') {
  return cleanString(value || '');
}

function hasArabicNameShape(value = '') {
  const tokens = normalizeDriver(value)
    .split(/\s+/)
    .filter((token) => ARABIC_TOKEN_PATTERN.test(token));
  return tokens.length >= 3 && tokens.length <= 6;
}

function hasWarehouseShape(value = '') {
  return WAREHOUSE_PATTERN.test(normalizeWarehouse(value));
}

function validateField(field, value = '') {
  const clean = cleanString(value);
  if (!clean) return false;

  if (field === 'vehicleNumber') return VEHICLE_PATTERN.test(normalizeVehicle(clean));
  if (field === 'driverName') return hasArabicNameShape(clean);
  if (field === 'loadingWarehouseName') return hasWarehouseShape(clean);
  if (field === 'productType') return Boolean(clean);
  return true;
}

function normalizeFieldValue(field, value = '') {
  if (field === 'vehicleNumber') return normalizeVehicle(value);
  if (field === 'driverName') return normalizeDriver(value);
  if (field === 'loadingWarehouseName') return normalizeWarehouse(value);
  if (field === 'productType') return normalizeProductType(value);
  if (field === 'documentNumber') return normalizeDocumentNumber(value) || cleanString(value);
  if (field === 'documentType') return canonicalDocumentType(value) || cleanString(value);
  if (field === 'issueDate') return normalizeDateValue(value) || cleanString(value);
  if (field === 'suppliedQuantityLiters') return normalizeQuantity(value);
  return cleanString(value);
}

function pickBestFieldValue({
  field,
  primaryValue = '',
  primaryConfidence = 0,
  candidateValues = [],
}) {
  const candidateStore = new Map();

  pushUniqueCandidate(candidateStore, primaryValue, primaryConfidence);
  for (const item of asArray(candidateValues)) {
    if (typeof item === 'string') {
      pushUniqueCandidate(candidateStore, item, primaryConfidence * 0.9);
      continue;
    }
    if (item && typeof item === 'object') {
      pushUniqueCandidate(
        candidateStore,
        item.value || item.text || item.candidate || '',
        item.confidence ?? primaryConfidence * 0.9
      );
    }
  }

  const pool = Array.from(candidateStore.values())
    .map((candidate) => {
      const normalized = normalizeFieldValue(field, candidate.value);
      return {
        value: normalized,
        confidence: candidate.confidence,
        isValid: validateField(field, normalized),
      };
    })
    .filter((item) => Boolean(item.value));

  if (!pool.length) {
    return {
      value: '',
      confidence: 0,
      topCandidates: [],
    };
  }

  pool.sort((a, b) => {
    if (a.isValid !== b.isValid) return a.isValid ? -1 : 1;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.value.length - a.value.length;
  });

  return {
    value: pool[0].value,
    confidence: Number(pool[0].confidence.toFixed(3)),
    topCandidates: pool.slice(0, 5).map((item) => ({
      value: item.value,
      confidence: Number(item.confidence.toFixed(3)),
      valid: item.isValid,
    })),
  };
}

function parseFieldConfidence(parsed = {}, field = '', globalConfidence = 0) {
  const byField = parsed.fieldConfidence || parsed.confidenceByField || parsed.confidences || {};
  if (!byField || typeof byField !== 'object') return clamp01(globalConfidence, 0);
  return clamp01(byField[field], clamp01(globalConfidence, 0));
}

function parseCandidates(parsed = {}, field = '') {
  const candidatesObject = parsed.candidates && typeof parsed.candidates === 'object'
    ? parsed.candidates
    : {};

  const directList = [];
  const fromGeneric = candidatesObject[field];
  if (fromGeneric) directList.push(...asArray(fromGeneric));

  const byName = parsed[`${field}Candidates`];
  if (byName) directList.push(...asArray(byName));

  return directList;
}

function scoreAttempt(fields = {}) {
  let score = 0;

  const vehicleConfidence = clamp01(fields.fieldConfidence?.vehicleNumber, 0);
  const driverConfidence = clamp01(fields.fieldConfidence?.driverName, 0);
  const warehouseConfidence = clamp01(fields.fieldConfidence?.loadingWarehouseName, 0);
  const globalConfidence = clamp01(fields.confidence, 0);

  const vehicle = normalizeVehicle(fields.vehicleNumber || '');
  if (vehicle && VEHICLE_PATTERN.test(vehicle)) score += 7 + (vehicleConfidence * 2);
  else if (vehicle) score -= 3;

  const driver = normalizeDriver(fields.driverName || '');
  if (driver && hasArabicNameShape(driver)) score += 5 + (driverConfidence * 2);
  else if (driver) score -= 2;

  const warehouse = normalizeWarehouse(fields.loadingWarehouseName || '');
  if (warehouse && hasWarehouseShape(warehouse)) score += 4 + (warehouseConfidence * 1.5);
  else if (warehouse) score -= 1.5;

  if (normalizeDocumentNumber(fields.documentNumber || '')) score += 2;
  if (normalizeDateValue(fields.issueDate || '')) score += 1;
  if (normalizeProductType(fields.productType || '')) score += 1;
  if (normalizeQuantity(fields.suppliedQuantityLiters || '')) score += 1;

  score += globalConfidence;

  return Number(score.toFixed(3));
}

function buildPrompt(attempt = 1) {
  const focus =
    attempt === 1
      ? 'Read the full form once and extract all target fields.'
      : attempt === 2
        ? 'Focus on the top-right header table rows only. Avoid neighboring rows and stamps.'
        : 'Run a strict verification pass for critical fields and provide alternatives if uncertain.';

  return [
    'You are a strict OCR and vision extraction engine for Iraqi oil unloading forms.',
    'Do not explain. Return JSON only.',
    focus,
    'If a field is unclear, return an empty string.',
    'This form has a stable layout. Extract each field only from its expected row, never from nearby rows.',
    'Field locations:',
    '- documentType: the geometric icon near the logo on the upper-left of the main table. If it is inside a pentagon, return 68ا; inside a circle, return 68ب; inside a quadrilateral, return 68ج; inside a hexagon, return 126 تصديري. If the icon is inside a square box or four-sided frame, return 68ج.',
    '- documentNumber: the large Latin/number code under the logo, like A 171 35854.',
    '- issueDate: row labeled تاريخ الإصدار in the top-right header table.',
    '- loadingWarehouseName: row labeled الجهة المجهزة in the top-right header table.',
    '- receiverEntity: row labeled الجهة المرسل إليها in the top-right header table.',
    '- vehicleNumber: row labeled رقم السيارة in the top-right header table.',
    '- driverName: row labeled ?????? ???????????? in the lower driver-information table, above ?????? ????????????.',
    '- productType: the product or fuel type row when it exists. If the form does not show a product row, return an empty string.',
    '- suppliedQuantityLiters: the first numeric quantity row labeled ?????????? (??????) in the middle quantities table.',
    'Vehicle number may appear in one of these forms:',
    '- Latin canonical format like 21G55676',
    '- slash format like 55676/21G',
    '- Arabic local format like 10464/أ نجف',
    'Normalize vehicleNumber to the Latin canonical form only when it is clearly present. Otherwise return the exact readable local value.',
    'Driver name must be Arabic full name from the driver row only.',
    'Loading warehouse must come from loading warehouse row only.',
    'Receiver entity must come from receiver row only, not from loading warehouse or product rows.',
    'Never use stamps, signatures, or identity rows as substitutes for any target field.',
    'Output this JSON object:',
    '{',
    '  "documentNumber": "",',
    '  "documentType": "",',
    '  "issueDate": "",',
    '  "loadingWarehouseName": "",',
    '  "receiverEntity": "",',
    '  "vehicleNumber": "",',
    '  "driverName": "",',
    '  "productType": "",',
    '  "suppliedQuantityLiters": "",',
    '  "confidence": 0,',
    '  "fieldConfidence": {',
    '    "vehicleNumber": 0,',
    '    "driverName": 0,',
    '    "loadingWarehouseName": 0,',
    '    "productType": 0,',
    '    "documentNumber": 0,',
    '    "documentType": 0,',
    '    "issueDate": 0,',
    '    "receiverEntity": 0,',
    '    "suppliedQuantityLiters": 0',
    '  },',
    '  "candidates": {',
    '    "vehicleNumber": [],',
    '    "driverName": [],',
    '    "loadingWarehouseName": [],',
    '    "receiverEntity": [],',
    '    "documentType": [],',
    '    "documentNumber": [],',
    '    "issueDate": []',
    '  }',
    '}',
  ].join('\n');
}

async function runSingleAttempt({ client, dataUrl, attempt }) {
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: attempt === 1 ? 0 : 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(attempt) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const raw = completion?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonPayload(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      attempt,
      success: false,
      raw,
      error: 'Vision model did not return valid JSON',
    };
  }

  const globalConfidence = clamp01(parsed.confidence, 0);

  const vehicleChoice = pickBestFieldValue({
    field: 'vehicleNumber',
    primaryValue: parsed.vehicleNumber || '',
    primaryConfidence: parseFieldConfidence(parsed, 'vehicleNumber', globalConfidence),
    candidateValues: parseCandidates(parsed, 'vehicleNumber'),
  });

  const driverChoice = pickBestFieldValue({
    field: 'driverName',
    primaryValue: parsed.driverName || '',
    primaryConfidence: parseFieldConfidence(parsed, 'driverName', globalConfidence),
    candidateValues: parseCandidates(parsed, 'driverName'),
  });

  const warehouseChoice = pickBestFieldValue({
    field: 'loadingWarehouseName',
    primaryValue: parsed.loadingWarehouseName || '',
    primaryConfidence: parseFieldConfidence(parsed, 'loadingWarehouseName', globalConfidence),
    candidateValues: parseCandidates(parsed, 'loadingWarehouseName'),
  });

  const documentNumberChoice = pickBestFieldValue({
    field: 'documentNumber',
    primaryValue: parsed.documentNumber || '',
    primaryConfidence: parseFieldConfidence(parsed, 'documentNumber', globalConfidence),
    candidateValues: parseCandidates(parsed, 'documentNumber'),
  });

  const documentTypeChoice = pickBestFieldValue({
    field: 'documentType',
    primaryValue: parsed.documentType || '',
    primaryConfidence: parseFieldConfidence(parsed, 'documentType', globalConfidence),
    candidateValues: parseCandidates(parsed, 'documentType'),
  });

  const issueDateChoice = pickBestFieldValue({
    field: 'issueDate',
    primaryValue: parsed.issueDate || '',
    primaryConfidence: parseFieldConfidence(parsed, 'issueDate', globalConfidence),
    candidateValues: parseCandidates(parsed, 'issueDate'),
  });

  const receiverEntityChoice = pickBestFieldValue({
    field: 'receiverEntity',
    primaryValue: parsed.receiverEntity || '',
    primaryConfidence: parseFieldConfidence(parsed, 'receiverEntity', globalConfidence),
    candidateValues: parseCandidates(parsed, 'receiverEntity'),
  });

  const fields = {
    documentNumber: documentNumberChoice.value,
    documentType: documentTypeChoice.value,
    issueDate: issueDateChoice.value,
    loadingWarehouseName: warehouseChoice.value,
    receiverEntity: receiverEntityChoice.value,
    vehicleNumber: vehicleChoice.value,
    driverName: driverChoice.value,
    productType: cleanString(parsed.productType || ''),
    suppliedQuantityLiters: normalizeFieldValue('suppliedQuantityLiters', parsed.suppliedQuantityLiters || ''),
    confidence: Number(globalConfidence.toFixed(3)),
    fieldConfidence: {
      vehicleNumber: vehicleChoice.confidence,
      driverName: driverChoice.confidence,
      loadingWarehouseName: warehouseChoice.confidence,
      productType: clamp01(parseFieldConfidence(parsed, 'productType', globalConfidence), 0.6),
      documentNumber: documentNumberChoice.confidence,
      documentType: documentTypeChoice.confidence,
      issueDate: issueDateChoice.confidence,
      receiverEntity: receiverEntityChoice.confidence,
      suppliedQuantityLiters: Number(parseFieldConfidence(parsed, 'suppliedQuantityLiters', globalConfidence).toFixed(3)),
    },
  };

  const criticalPresenceCount = [
    fields.vehicleNumber && VEHICLE_PATTERN.test(fields.vehicleNumber),
    fields.driverName && hasArabicNameShape(fields.driverName),
    fields.loadingWarehouseName && hasWarehouseShape(fields.loadingWarehouseName),
  ].filter(Boolean).length;

  const score = scoreAttempt(fields);

  return {
    attempt,
    success: true,
    raw,
    score,
    criticalPresenceCount,
    fields,
    topCandidates: {
      documentNumber: documentNumberChoice.topCandidates,
      documentType: documentTypeChoice.topCandidates,
      issueDate: issueDateChoice.topCandidates,
      receiverEntity: receiverEntityChoice.topCandidates,
      vehicleNumber: vehicleChoice.topCandidates,
      driverName: driverChoice.topCandidates,
      loadingWarehouseName: warehouseChoice.topCandidates,
    },
  };
}

function combineTopCandidates(attempts = [], field = '') {
  const merged = new Map();
  for (const attempt of attempts) {
    const list = asArray(attempt?.topCandidates?.[field]);
    for (const item of list) {
      pushUniqueCandidate(merged, item?.value || '', item?.confidence ?? 0.4);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function pickBestAttempt(attempts = []) {
  const successful = attempts.filter((item) => item.success);
  if (!successful.length) return null;
  successful.sort((a, b) => {
    if (a.criticalPresenceCount !== b.criticalPresenceCount) {
      return b.criticalPresenceCount - a.criticalPresenceCount;
    }
    if (a.score !== b.score) return b.score - a.score;
    return b.fields.confidence - a.fields.confidence;
  });
  return successful[0];
}

async function runUnloadingVisionReview({ imageBuffer, mimeType = 'image/jpeg' }) {
  const client = getGroqClient();
  if (!client) {
    return { available: false, success: false, message: 'GROQ_API_KEY is not configured' };
  }

  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    return { available: true, success: false, message: 'Invalid image buffer' };
  }

  try {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64Image}`;

    const prompt = [
      'أنت مدقق مستندات تفريغ نفط بالعراق.',
      'استخرج فقط الحقول التالية من الصورة بدقة عالية وبلا تخمين:',
      '- documentNumber',
      '- documentType: the small geometric icon near the logo; if it is pentagon-shaped return 68ا, circle-shaped return 68ب, four-sided/boxed return 68ج, and hexagon-shaped return 126 تصديري.',
      '- issueDate',
      '- loadingWarehouseName',
      '- receiverEntity',
      '- vehicleNumber',
      '- driverName',
      '- suppliedQuantityLiters',
      'أعد النتيجة JSON فقط بهذا الشكل:',
      '{',
      '  "documentNumber": "",',
      '  "documentType": "",',
      '  "issueDate": "",',
      '  "loadingWarehouseName": "",',
      '  "receiverEntity": "",',
      '  "vehicleNumber": "",',
      '  "driverName": "",',
      '  "suppliedQuantityLiters": "",',
      '  "confidence": 0',
      '}',
      'إذا الحقل غير واضح اتركه فارغًا.',
    ].join('\n');

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const content = completion?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonPayload(content);

    if (!parsed || typeof parsed !== 'object') {
      return {
        available: true,
        success: false,
        model: DEFAULT_MODEL,
        message: 'Vision model did not return valid JSON',
        raw: content,
      };
    }

    return {
      available: true,
      success: true,
      model: DEFAULT_MODEL,
      raw: content,
      fields: {
        documentNumber: cleanString(parsed.documentNumber),
        documentType: cleanString(parsed.documentType),
        issueDate: cleanString(parsed.issueDate),
        loadingWarehouseName: cleanString(parsed.loadingWarehouseName),
        receiverEntity: cleanString(parsed.receiverEntity),
        vehicleNumber: cleanString(parsed.vehicleNumber),
        driverName: cleanString(parsed.driverName),
        suppliedQuantityLiters: cleanString(parsed.suppliedQuantityLiters),
        confidence: Number(parsed.confidence || 0),
      },
    };
  } catch (error) {
    return {
      available: true,
      success: false,
      model: DEFAULT_MODEL,
      message: error.message,
    };
  }
}

async function runUnloadingVisionReviewV2({ imageBuffer, mimeType = 'image/jpeg' }) {
  const client = getGroqClient();
  if (!client) {
    return { available: false, success: false, message: 'GROQ_API_KEY is not configured' };
  }

  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    return { available: true, success: false, message: 'Invalid image buffer' };
  }

  try {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64Image}`;
    const attempts = [];

    for (let attempt = 1; attempt <= Math.max(1, MAX_ATTEMPTS); attempt += 1) {
      try {
        // Multiple passes make extraction stable for strict fail-closed checks.
        const result = await runSingleAttempt({ client, dataUrl, attempt });
        attempts.push(result);
      } catch (error) {
        attempts.push({
          attempt,
          success: false,
          error: error.message,
          raw: '',
        });
      }
    }

    const best = pickBestAttempt(attempts);
    if (!best) {
      return {
        available: true,
        success: false,
        model: DEFAULT_MODEL,
        message: 'Vision extraction attempts failed',
        attempts: attempts.map((item) => ({
          attempt: item.attempt,
          success: item.success,
          error: item.error || '',
        })),
      };
    }

    return {
      available: true,
      success: true,
      model: DEFAULT_MODEL,
      bestAttempt: best.attempt,
      score: best.score,
      fields: { ...best.fields },
      topCandidates: {
        documentNumber: combineTopCandidates(attempts, 'documentNumber'),
        documentType: combineTopCandidates(attempts, 'documentType'),
        issueDate: combineTopCandidates(attempts, 'issueDate'),
        receiverEntity: combineTopCandidates(attempts, 'receiverEntity'),
        vehicleNumber: combineTopCandidates(attempts, 'vehicleNumber'),
        driverName: combineTopCandidates(attempts, 'driverName'),
        loadingWarehouseName: combineTopCandidates(attempts, 'loadingWarehouseName'),
      },
      attempts: attempts.map((item) => ({
        attempt: item.attempt,
        success: item.success,
        score: item.score || 0,
        criticalPresenceCount: item.criticalPresenceCount || 0,
      })),
      raw: cleanValue(best.raw || ''),
    };
  } catch (error) {
    return {
      available: true,
      success: false,
      model: DEFAULT_MODEL,
      message: error.message,
    };
  }
}

module.exports = {
  runUnloadingVisionReview: runUnloadingVisionReviewV2,
  normalizeVehicle,
  normalizeDriver,
  normalizeWarehouse,
  hasArabicNameShape,
};
