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
} = require('./unloadingFieldReader');
const { isGoldenRefinery, repairBrokenWords } = require('./arabicFuzzy');

const GEMINI_MODEL = process.env.UNLOADING_GEMINI_MODEL || 'gemini-2.5-flash';
const CANONICAL_RECEIVER =
  'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';

function cleanString(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
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

function extractGeminiJson(payload = {}) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === 'string') {
        const parsed = parseJsonPayload(part.text);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

function normalizeQuantity(value = '') {
  const western = String(value || '').replace(/[\u0660-\u0669]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
  const matches = western.match(/\d{3,6}/g) || [];
  const list = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 1000 && item <= 60000);
  if (!list.length) return '';
  return String(list.sort((a, b) => b - a)[0]);
}

function normalizeFields(raw = {}) {
  const receiverRaw = repairBrokenWords(cleanString(raw.receiverEntity || ''));
  return {
    documentNumber: normalizeDocumentNumber(raw.documentNumber || '') || '',
    documentType: canonicalDocumentType(raw.documentType || '') || '',
    issueDate: normalizeDateValue(raw.issueDate || '') || '',
    loadingWarehouseName: sanitizeWarehouseName(
      sanitizeWarehouseStrictValue(raw.loadingWarehouseName || '')
    ),
    receiverEntity: isGoldenRefinery(receiverRaw)
      ? (canonicalReceiverEntity(receiverRaw, '') || CANONICAL_RECEIVER)
      : receiverRaw,
    vehicleNumber: canonicalVehicleValue(raw.vehicleNumber || ''),
    driverName: sanitizeDriverName(raw.driverName || ''),
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
      suppliedQuantityLiters: clamp01(raw.fieldConfidence?.suppliedQuantityLiters, 0.6),
    },
  };
}

function buildScore(fields = {}) {
  let score = 0;
  if (fields.documentNumber) score += 6;
  if (fields.documentType) score += 5;
  if (fields.issueDate) score += 4;
  if (fields.loadingWarehouseName) score += 5;
  if (fields.receiverEntity) score += 6;
  if (fields.vehicleNumber) score += 6;
  if (fields.driverName) score += 4;
  if (fields.suppliedQuantityLiters) score += 2;
  score += Object.values(fields.fieldConfidence || {}).reduce(
    (sum, value) => sum + clamp01(value, 0),
    0
  );
  return Number(score.toFixed(3));
}

function buildSchema() {
  return {
    type: 'object',
    properties: {
      documentNumber: { type: 'string' },
      documentType: { type: 'string' },
      issueDate: { type: 'string' },
      loadingWarehouseName: { type: 'string' },
      receiverEntity: { type: 'string' },
      vehicleNumber: { type: 'string' },
      driverName: { type: 'string' },
      suppliedQuantityLiters: { type: 'string' },
      rawText: { type: 'string' },
      fieldConfidence: {
        type: 'object',
        properties: {
          documentNumber: { type: 'number' },
          documentType: { type: 'number' },
          issueDate: { type: 'number' },
          loadingWarehouseName: { type: 'number' },
          receiverEntity: { type: 'number' },
          vehicleNumber: { type: 'number' },
          driverName: { type: 'number' },
          suppliedQuantityLiters: { type: 'number' },
        },
        required: [
          'documentNumber',
          'documentType',
          'issueDate',
          'loadingWarehouseName',
          'receiverEntity',
          'vehicleNumber',
          'driverName',
          'suppliedQuantityLiters',
        ],
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
      'suppliedQuantityLiters',
      'rawText',
      'fieldConfidence',
    ],
  };
}

async function runUnloadingGeminiReview({ imageBuffer, mimeType }) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      available: false,
      success: false,
      message: 'GEMINI_API_KEY غير موجود',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
      source: 'gemini_document_ai',
    };
  }

  const prompt = `
استخرج حقول مستند التفريغ العراقي من الصورة وأعد JSON فقط.

قواعد مهمة:
- documentNumber = الحرف A غالباً ثم 8 أرقام، مثال A28193322. لا تتركه فارغاً إذا كان ظاهرًا تحت شعار OPDC.
- documentType = 68ا أو 68أ أو 68ب أو 68ج أو 126 تصديري فقط. إذا كان الرمز الهندسي داخل شكل خماسي فالقيمة 68ا، وداخل شكل دائري فالقيمة 68ب، وداخل شكل رباعي/مربع فالقيمة 68ج، وداخل شكل سداسي فالقيمة 126 تصديري. اقرأه من الرمز الهندسي قرب QR/الشعار.
- issueDate بصيغة YYYY-MM-DD.
- loadingWarehouseName = الجهة المجهزة فقط من الجدول العلوي الأيمن.
- receiverEntity = الجهة المرسل إليها فقط من الجدول العلوي الأيمن.
- vehicleNumber = رقم السيارة كما هو مكتوب في المستند، مثل 17668/21B أو 10464/أ نجف.
- driverName = اسم السائق فقط من سطر "اسم السائق" أسفل المستند. لا تستخدم اسم موظف التجهيز ولا اسم الأم ولا الختم.
- suppliedQuantityLiters = كمية "طبيعي (لتر)" في الجدول الأوسط.
- rawText = النص المفيد الأساسي المستخرج من الصورة.
- fieldConfidence = قيم من 0 إلى 1.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: imageBuffer.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: buildSchema(),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini extractor failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const parsed = extractGeminiJson(payload);
  if (!parsed) {
    return {
      available: true,
      success: false,
      message: 'تعذر تفسير استجابة Gemini',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: GEMINI_MODEL,
      source: 'gemini_document_ai',
    };
  }

  const fields = normalizeFields(parsed);
  const score = buildScore(fields);
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

module.exports = {
  runUnloadingGeminiReview,
};
