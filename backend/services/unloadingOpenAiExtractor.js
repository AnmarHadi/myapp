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

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = process.env.UNLOADING_OPENAI_MODEL || 'gpt-4.1-mini';
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

function extractResponseJson(payload = {}) {
  if (payload.output_text) {
    return parseJsonPayload(payload.output_text);
  }

  const outputs = Array.isArray(payload.output) ? payload.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === 'string') {
        const parsed = parseJsonPayload(chunk.text);
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
    name: 'unloading_document_extract',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
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
          additionalProperties: false,
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
        },
      },
    },
  };
}

async function runUnloadingOpenAiReview({ imageBuffer, mimeType }) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      available: false,
      success: false,
      message: 'OPENAI_API_KEY غير موجود',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
      source: 'openai_document_ai',
    };
  }

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`;
  const prompt = `
استخرج حقول مستند التفريغ العراقي من الصورة وأعد JSON فقط.

قواعد مهمة:
- documentNumber = حرف إنكليزي + 8 أرقام مثل A17135854.
- documentType = 68ا أو 68أ أو 68ب أو 68ج أو 126 تصديري فقط. إذا كان الرمز داخل شكل خماسي فالقيمة 68ا، وداخل شكل دائري 68ب، وداخل شكل رباعي/مربع فالقيمة 68ج، وداخل شكل سداسي 126 تصديري. لا تعِد وصفاً عاماً مثل "مستند إصدار الوقود".
- issueDate بصيغة YYYY-MM-DD.
- loadingWarehouseName = الجهة المجهزة فقط.
- receiverEntity = الجهة المرسل إليها فقط.
- vehicleNumber = الصيغة النهائية الموحدة، مثل 21G55676 أو أ10464.
- driverName = اسم السائق فقط، ولا يجوز أن يكون اسم موظف التجهيز أو العنوان الوظيفي أو الختم.
- suppliedQuantityLiters = كمية طبيعي (لتر) فقط.
- rawText = النص المفيد الأساسي المستخرج من الصورة.
- fieldConfidence = قيم من 0 إلى 1.
`;

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl, detail: 'high' },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          ...buildSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI extractor failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const parsed = extractResponseJson(payload);
  if (!parsed) {
    return {
      available: true,
      success: false,
      message: 'تعذر تفسير استجابة OpenAI',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: OPENAI_MODEL,
      source: 'openai_document_ai',
    };
  }

  const fields = normalizeFields(parsed);
  return {
    available: true,
    success: true,
    message: '',
    fields,
    attempts: [
      {
        attempt: 1,
        success: true,
        score: buildScore(fields),
      },
    ],
    bestAttempt: 1,
    score: buildScore(fields),
    topCandidates: {},
    model: OPENAI_MODEL,
    source: 'openai_document_ai',
  };
}

module.exports = {
  runUnloadingOpenAiReview,
};
