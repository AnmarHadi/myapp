const Groq = require('groq-sdk');

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

const DEFAULT_MODEL =
  process.env.UNLOADING_DOCUMENT_AI_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_ATTEMPTS = Math.max(
  1,
  Math.min(2, Number(process.env.UNLOADING_DOCUMENT_AI_ATTEMPTS || 2))
);
const VEHICLE_PATTERN = /^\d{2}[A-Z]\d{4,6}$/;
const ARABIC_NAME_TOKEN = /^[\u0621-\u064A]{2,}$/;
const CANONICAL_RECEIVER =
  'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';

let cachedClient = null;

function getClient() {
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

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) {
    return Math.max(0, Math.min(1, number / 100));
  }
  return Math.max(0, Math.min(1, number));
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

function normalizeQuantity(value = '') {
  const matches = toWesternDigits(String(value || '')).match(/\d{3,6}/g) || [];
  const list = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 1000 && item <= 60000);
  if (!list.length) return '';
  return String(list.sort((a, b) => b - a)[0]);
}

function cleanString(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripDriverNoise(value = '') {
  return cleanString(String(value || ''))
    .replace(/اسم\s*السائق/gi, '')
    .replace(/اسم\s*السايق/gi, '')
    .replace(/موظف\s*التجهيز.*/gi, '')
    .replace(/العنوان\s*الوظيفي.*/gi, '')
    .replace(/وقت\s*الإرسال.*/gi, '')
    .replace(/وقت\s*الارسال.*/gi, '')
    .replace(/التوقيع.*/gi, '')
    .trim();
}

function compactText(value = '') {
  return cleanString(String(value || '').replace(/[\u200f\u200e]/g, ' '));
}

function extractBetweenLabels(rawText = '', startLabels = [], endLabels = []) {
  const source = compactText(rawText);
  if (!source) return '';

  let startIndex = -1;
  let startLength = 0;

  for (const label of startLabels) {
    const idx = source.indexOf(label);
    if (idx >= 0 && (startIndex === -1 || idx < startIndex)) {
      startIndex = idx;
      startLength = label.length;
    }
  }

  if (startIndex < 0) return '';

  const from = startIndex + startLength;
  let endIndex = source.length;

  for (const label of endLabels) {
    const idx = source.indexOf(label, from);
    if (idx >= 0 && idx < endIndex) {
      endIndex = idx;
    }
  }

  return cleanString(source.slice(from, endIndex));
}

function extractDocumentNumberFromRawText(rawText = '') {
  const compact = toWesternDigits(rawText).replace(/\s+/g, '');
  const match = compact.match(/\b([A-Z]\d{8})\b/);
  return match?.[1] || '';
}

function extractFirstDate(rawText = '') {
  const match = toWesternDigits(rawText).match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/);
  return match?.[1] || '';
}

function extractQuantityFromRawText(rawText = '') {
  const afterNatural = extractBetweenLabels(
    rawText,
    ['طبيعي (لتر)', 'طبيعي(لتر)', 'طبيعي'],
    ['قياسي (لتر)', 'قياسي(لتر)', 'الوزن (كغم)', 'الوزن(كغم)', 'برميل']
  );
  if (afterNatural) {
    const quantity = normalizeQuantity(afterNatural);
    if (quantity) return quantity;
  }
  return '';
}

function extractRawTextHints(rawText = '') {
  const source = compactText(rawText);
  const documentNumber = extractDocumentNumberFromRawText(source);
  const issueDate =
    extractBetweenLabels(source, ['تاريخ الإصدار', 'تاريخ الاصدار'], ['الجهة المرسل اليها', 'الجهة المرسل إليها']) ||
    extractFirstDate(source);
  const loadingWarehouseName = extractBetweenLabels(
    source,
    ['الجهة المجهزة', 'الجهة المجهزه'],
    ['تاريخ الإصدار', 'تاريخ الاصدار']
  );
  const receiverEntity = extractBetweenLabels(
    source,
    ['الجهة المرسل اليها', 'الجهة المرسل إليها'],
    ['الشركة/المخول', 'الشركة / المخول', 'رقم السيارة', 'نوع المنتوج']
  );
  const vehicleNumber = extractBetweenLabels(
    source,
    ['رقم السيارة', 'رقم المركبة'],
    ['نوع المنتوج', 'زيت الوقود', 'الكمية المجهزة']
  );
  const driverName = extractBetweenLabels(
    source,
    ['اسم السائق'],
    ['اسم الام', 'اسم الأم', 'رقم الهوية', 'تاريخ الهوية']
  );
  const suppliedQuantityLiters = extractQuantityFromRawText(source);

  return {
    documentNumber,
    issueDate,
    loadingWarehouseName,
    receiverEntity,
    vehicleNumber,
    driverName,
    suppliedQuantityLiters,
  };
}

function hasArabicNameShape(value = '') {
  const tokens = sanitizeDriverName(stripDriverNoise(value || ''))
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => ARABIC_NAME_TOKEN.test(token));
  return tokens.length >= 3 && tokens.length <= 6;
}

function normalizeFieldValue(field, value = '') {
  if (field === 'documentNumber') return normalizeDocumentNumber(value) || cleanString(value);
  if (field === 'documentType') return canonicalDocumentType(value) || cleanString(value);
  if (field === 'issueDate') return normalizeDateValue(value) || cleanString(value);
  if (field === 'loadingWarehouseName') {
    return sanitizeWarehouseName(sanitizeWarehouseStrictValue(value || ''));
  }
  if (field === 'receiverEntity') {
    const repaired = repairBrokenWords(cleanString(value));
    if (isGoldenRefinery(repaired)) {
      return canonicalReceiverEntity(repaired, '') || CANONICAL_RECEIVER;
    }
    return repaired;
  }
  if (field === 'vehicleNumber') return canonicalVehicleValue(value);
  if (field === 'driverName') return sanitizeDriverName(stripDriverNoise(value));
  if (field === 'suppliedQuantityLiters') return normalizeQuantity(value);
  return cleanString(value);
}

function validateField(field, value = '') {
  const current = cleanString(value);
  if (!current) return false;
  if (field === 'documentNumber') return /^[A-Z]\d{8}$/.test(normalizeDocumentNumber(current));
  if (field === 'documentType') return Boolean(canonicalDocumentType(current));
  if (field === 'issueDate') return Boolean(normalizeDateValue(current));
  if (field === 'loadingWarehouseName') {
    return /(?:مستودع|مصفى|مصفاة)/.test(
      sanitizeWarehouseName(sanitizeWarehouseStrictValue(current))
    );
  }
  if (field === 'receiverEntity') return isGoldenRefinery(current);
  if (field === 'vehicleNumber') return VEHICLE_PATTERN.test(canonicalVehicleValue(current));
  if (field === 'driverName') return hasArabicNameShape(current);
  if (field === 'suppliedQuantityLiters') return Boolean(normalizeQuantity(current));
  return true;
}

function candidateValueObjects(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function isDriverNoiseCandidate(value = '') {
  return /موظف\s*التجهيز|العنوان\s*الوظيفي|وقت\s*الإرسال|وقت\s*الارسال|التوقيع/i
    .test(String(value || ''));
}

function buildCandidates(field, parsed = {}, primaryValue = '', primaryConfidence = 0) {
  const store = new Map();

  const push = (value, confidence = 0.5) => {
    if (field === 'driverName' && isDriverNoiseCandidate(value)) return;
    const normalized = normalizeFieldValue(field, value || '');
    if (!normalized) return;
    const key = normalized.toLowerCase();
    const next = {
      value: normalized,
      confidence: Number(clamp01(confidence, 0.5).toFixed(3)),
      valid: validateField(field, normalized),
    };
    const prev = store.get(key);
    if (!prev || next.confidence > prev.confidence) {
      store.set(key, next);
    }
  };

  push(primaryValue, primaryConfidence);

  const rawCandidates =
    parsed?.candidates?.[field] ||
    parsed?.topCandidates?.[field] ||
    parsed?.[`${field}Candidates`] ||
    [];

  for (const item of candidateValueObjects(rawCandidates)) {
    if (typeof item === 'string') {
      push(item, primaryConfidence * 0.9 || 0.45);
      continue;
    }
    if (item && typeof item === 'object') {
      push(
        item.value || item.text || item.candidate || item.label || '',
        item.confidence ?? primaryConfidence * 0.9 ?? 0.45
      );
    }
  }

  return Array.from(store.values())
    .sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? -1 : 1;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.value.length - a.value.length;
    })
    .slice(0, 5);
}

function pickField(field, parsed = {}) {
  const byField = parsed?.fieldConfidence || {};
  const rawValue = parsed?.[field] || '';
  const normalized = normalizeFieldValue(field, rawValue);
  const confidence = clamp01(byField[field], validateField(field, normalized) ? 0.72 : 0.35);
  const topCandidates = buildCandidates(field, parsed, normalized, confidence);
  const chosen = topCandidates[0] || {
    value: normalized,
    confidence: Number(confidence.toFixed(3)),
    valid: validateField(field, normalized),
  };

  return {
    value: chosen.value || normalized,
    confidence: chosen.confidence,
    topCandidates,
  };
}

function scoreAttempt(fields = {}) {
  let score = 0;

  if (/^[A-Z]\d{8}$/.test(fields.documentNumber || '')) score += 6;
  if (canonicalDocumentType(fields.documentType || '')) score += 5;
  if (normalizeDateValue(fields.issueDate || '')) score += 4;
  if (validateField('loadingWarehouseName', fields.loadingWarehouseName || '')) score += 5;
  if (validateField('receiverEntity', fields.receiverEntity || '')) score += 6;
  if (validateField('vehicleNumber', fields.vehicleNumber || '')) score += 6;
  if (validateField('driverName', fields.driverName || '')) score += 4;
  if (normalizeQuantity(fields.suppliedQuantityLiters || '')) score += 2;

  const confidences = Object.values(fields.fieldConfidence || {})
    .map((value) => clamp01(value, 0))
    .filter((value) => Number.isFinite(value));
  if (confidences.length) {
    score += confidences.reduce((sum, value) => sum + value, 0);
  }

  if (fields.rawText && fields.rawText.length >= 120) score += 2;

  return Number(score.toFixed(3));
}

function isGoodEnough(fields = {}, score = 0) {
  return (
    /^[A-Z]\d{8}$/.test(fields.documentNumber || '') &&
    Boolean(canonicalDocumentType(fields.documentType || '')) &&
    Boolean(normalizeDateValue(fields.issueDate || '')) &&
    validateField('loadingWarehouseName', fields.loadingWarehouseName || '') &&
    validateField('receiverEntity', fields.receiverEntity || '') &&
    validateField('vehicleNumber', fields.vehicleNumber || '') &&
    score >= 18
  );
}

async function runVisionToRawText(client, dataUrl, attempt = 1) {
  const extra =
    attempt === 1
      ? ''
      : `
- راجع الصفوف العلوية اليمنى صفاً صفاً ولا تكتفِ بعنوان المستند.
- التقط أيضاً القيم التي تكون داخل الجدول وليس فقط بجانب اللابل.
- إذا ظهر نوع المستند عند الرمز الهندسي فاكتبه صراحة.
- إذا ظهر رقم المركبة بصيغ مثل 55676/21G أو 10464/أ نجف فاكتبه كاملاً كما هو.
`;

  const prompt = `
أنت محرك OCR/Document AI متخصص في مستندات التفريغ العراقية.
المطلوب استخراج النص من صورة واحدة لمستند تفريغ وقود/منتجات نفطية.

قواعد مهمة:
- أعد JSON فقط.
- استخرج النص كما يظهر في الصورة دون شرح.
- حافظ تقريباً على ترتيب السطور.
- اعتبر الجدول العلوي الأيمن هو المصدر الأساسي للحقول التالية:
  - الجهة المجهزة
  - تاريخ الإصدار
  - الجهة المرسل إليها
  - رقم السيارة/المقاول
- رقم المستند يوجد تحت الشعار.
- نوع المستند يوجد قرب الرمز الهندسي الصغير، وعادته 68ا أو 68أ أو 68ب أو 68ج أو 126 تصديري. إذا كان داخل شكل خماسي فالقيمة 68ا، وداخل شكل دائري 68ب، وداخل شكل رباعي/مربع فالقيمة 68ج، وداخل شكل سداسي 126 تصديري.
- اسم السائق يوجد في الجزء السفلي الأيسر في جدول السائق فوق رقم الهوية مباشرة.
- الكمية المجهزة المطلوبة هي كمية طبيعي (لتر) في الجدول الأوسط.
- لا تستخدم الأختام أو التواقيع أو النصوص أسفل الصفحة بدل الحقول الأساسية.
${extra}

أعد JSON فقط بهذا الشكل:
{
  "rawText": "",
  "fieldHints": {
    "documentNumber": "",
    "documentType": "",
    "issueDate": "",
    "loadingWarehouseName": "",
    "receiverEntity": "",
    "vehicleNumber": "",
    "driverName": "",
    "suppliedQuantityLiters": ""
  }
}
`;

  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
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
  return parseJsonPayload(content) || {};
}

async function runRawTextToFields(client, rawText = '', fieldHints = {}) {
  const prompt = `
أنت خبير في تفسير النصوص المستخرجة من مستندات التفريغ العراقية.
أعد JSON فقط بدون أي شرح.

النص الخام:
${rawText}

إشارات مباشرة من الصورة:
${JSON.stringify(fieldHints || {}, null, 2)}

استخرج الحقول التالية فقط:
{
  "documentNumber": "",
  "documentType": "",
  "issueDate": "",
  "loadingWarehouseName": "",
  "receiverEntity": "",
  "vehicleNumber": "",
  "driverName": "",
  "suppliedQuantityLiters": "",
  "fieldConfidence": {
    "documentNumber": 0,
    "documentType": 0,
    "issueDate": 0,
    "loadingWarehouseName": 0,
    "receiverEntity": 0,
    "vehicleNumber": 0,
    "driverName": 0,
    "suppliedQuantityLiters": 0
  },
  "candidates": {
    "documentNumber": [],
    "documentType": [],
    "issueDate": [],
    "loadingWarehouseName": [],
    "receiverEntity": [],
    "vehicleNumber": [],
    "driverName": [],
    "suppliedQuantityLiters": []
  }
}

قواعد دقيقة:
- documentNumber يجب أن يكون حرفاً إنكليزياً + 8 أرقام مثل A28190717.
- documentType لا يجوز أن يكون وصفاً عاماً مثل "مستند إصدار الوقود". القيم المقبولة: 68ا أو 68أ أو 68ب أو 68ج أو 126 تصديري فقط. إذا كان الرمز داخل شكل خماسي فالقيمة 68ا، وداخل شكل دائري 68ب، وداخل شكل رباعي/مربع فالقيمة 68ج، وداخل شكل سداسي 126 تصديري.
- issueDate بصيغة YYYY-MM-DD إذا أمكن.
- loadingWarehouseName هي الجهة المجهزة أو مستودع التحميل فقط، مثل: مستودع النجف الجديد، مصفى السماوة، مصفى الناصرية.
- receiverEntity هي الجهة المرسل إليها فقط. إذا ظهر مصفى النفط الذهبي أو الشبكة الذهبية القابضة أو صياغة مشابهة فاستخرجها كنص الجهة نفسها.
- vehicleNumber إذا كانت الصيغة 55676/21G فأعدها نهائياً بالشكل 21G55676.
- vehicleNumber إذا كانت الصيغة المحلية 10464/أ نجف فأعدها نهائياً بالشكل أ10464، واترك المحافظة ضمن النص الخام أو المرشحات فقط.
- driverName يجب أن يكون الاسم العربي الكامل للسائق فقط، لا اسم الأم ولا الختم.
- suppliedQuantityLiters هي كمية الطبيعي (لتر) في الجدول الأوسط.
- إذا كانت قيمة ما غير واضحة فاتركها "".
`;

  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });

  const content = completion?.choices?.[0]?.message?.content || '';
  return parseJsonPayload(content) || {};
}

async function runUnloadingDocumentAiReview({ imageBuffer, mimeType }) {
  const client = getClient();
  if (!client) {
    return {
      available: false,
      success: false,
      message: 'GROQ_API_KEY غير موجود',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
    };
  }

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`;
  const attempts = [];
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const rawStage = await runVisionToRawText(client, dataUrl, attempt);
      const rawText = cleanString(rawStage?.rawText || '');
      const fieldHints = rawStage?.fieldHints && typeof rawStage.fieldHints === 'object'
        ? rawStage.fieldHints
        : {};

      if (!rawText && !Object.values(fieldHints).some(Boolean)) {
        attempts.push({
          attempt,
          success: false,
          rawText: '',
          score: 0,
          message: 'empty_raw_text',
        });
        continue;
      }

      const parsed = await runRawTextToFields(client, rawText, fieldHints);
      const rawTextHints = extractRawTextHints(rawText);
      const mergedCandidates = {
        documentNumber: [
          rawTextHints.documentNumber,
          fieldHints.documentNumber,
          ...(candidateValueObjects(parsed?.candidates?.documentNumber || [])),
        ].filter(Boolean),
        documentType: [
          fieldHints.documentType,
          parsed?.documentType,
          ...(candidateValueObjects(parsed?.candidates?.documentType || [])),
        ].filter(Boolean),
        issueDate: [
          rawTextHints.issueDate,
          fieldHints.issueDate,
          ...(candidateValueObjects(parsed?.candidates?.issueDate || [])),
        ].filter(Boolean),
        loadingWarehouseName: [
          rawTextHints.loadingWarehouseName,
          fieldHints.loadingWarehouseName,
          ...(candidateValueObjects(parsed?.candidates?.loadingWarehouseName || [])),
        ].filter(Boolean),
        receiverEntity: [
          rawTextHints.receiverEntity,
          fieldHints.receiverEntity,
          ...(candidateValueObjects(parsed?.candidates?.receiverEntity || [])),
        ].filter(Boolean),
        vehicleNumber: [
          rawTextHints.vehicleNumber,
          fieldHints.vehicleNumber,
          ...(candidateValueObjects(parsed?.candidates?.vehicleNumber || [])),
        ].filter(Boolean),
        driverName: [
          stripDriverNoise(rawTextHints.driverName || ''),
          stripDriverNoise(fieldHints.driverName || ''),
          ...candidateValueObjects(parsed?.candidates?.driverName || []).map((candidate) => {
            if (typeof candidate === 'string') return stripDriverNoise(candidate);
            if (candidate && typeof candidate === 'object') {
              return {
                ...candidate,
                value: stripDriverNoise(candidate.value || candidate.text || candidate.bestValue || ''),
              };
            }
            return candidate;
          }),
        ].filter(Boolean),
        suppliedQuantityLiters: [
          rawTextHints.suppliedQuantityLiters,
          fieldHints.suppliedQuantityLiters,
          ...(candidateValueObjects(parsed?.candidates?.suppliedQuantityLiters || [])),
        ].filter(Boolean),
      };

      const mergedParsed = {
        ...parsed,
        documentNumber:
          parsed.documentNumber || rawTextHints.documentNumber || fieldHints.documentNumber || '',
        documentType:
          parsed.documentType || fieldHints.documentType || '',
        issueDate:
          parsed.issueDate || rawTextHints.issueDate || fieldHints.issueDate || '',
        loadingWarehouseName:
          parsed.loadingWarehouseName
          || rawTextHints.loadingWarehouseName
          || fieldHints.loadingWarehouseName
          || '',
        receiverEntity:
          parsed.receiverEntity || rawTextHints.receiverEntity || fieldHints.receiverEntity || '',
        vehicleNumber:
          parsed.vehicleNumber || rawTextHints.vehicleNumber || fieldHints.vehicleNumber || '',
        driverName:
          stripDriverNoise(parsed.driverName || '')
          || stripDriverNoise(rawTextHints.driverName || '')
          || stripDriverNoise(fieldHints.driverName || '')
          || '',
        suppliedQuantityLiters:
          parsed.suppliedQuantityLiters
          || rawTextHints.suppliedQuantityLiters
          || fieldHints.suppliedQuantityLiters
          || '',
        candidates: mergedCandidates,
      };

      const documentNumber = pickField('documentNumber', {
        ...mergedParsed,
        documentNumber: mergedParsed.documentNumber,
      });
      const documentType = pickField('documentType', {
        ...mergedParsed,
        documentType: mergedParsed.documentType,
      });
      const issueDate = pickField('issueDate', {
        ...mergedParsed,
        issueDate: mergedParsed.issueDate,
      });
      const loadingWarehouseName = pickField('loadingWarehouseName', {
        ...mergedParsed,
        loadingWarehouseName: mergedParsed.loadingWarehouseName,
      });
      const receiverEntity = pickField('receiverEntity', {
        ...mergedParsed,
        receiverEntity: mergedParsed.receiverEntity,
      });
      const vehicleNumber = pickField('vehicleNumber', {
        ...mergedParsed,
        vehicleNumber: mergedParsed.vehicleNumber,
      });
      const driverName = pickField('driverName', {
        ...mergedParsed,
        driverName: mergedParsed.driverName,
      });
      const suppliedQuantityLiters = pickField('suppliedQuantityLiters', {
        ...mergedParsed,
        suppliedQuantityLiters: mergedParsed.suppliedQuantityLiters,
      });

      const fields = {
        documentNumber: documentNumber.value,
        documentType: documentType.value,
        issueDate: issueDate.value,
        loadingWarehouseName: loadingWarehouseName.value,
        receiverEntity: receiverEntity.value,
        vehicleNumber: vehicleNumber.value,
        driverName: driverName.value,
        suppliedQuantityLiters: suppliedQuantityLiters.value,
        rawText,
        fieldConfidence: {
          documentNumber: documentNumber.confidence,
          documentType: documentType.confidence,
          issueDate: issueDate.confidence,
          loadingWarehouseName: loadingWarehouseName.confidence,
          receiverEntity: receiverEntity.confidence,
          vehicleNumber: vehicleNumber.confidence,
          driverName: driverName.confidence,
          suppliedQuantityLiters: suppliedQuantityLiters.confidence,
        },
      };

      const score = scoreAttempt(fields);
      const reviewAttempt = {
        attempt,
        success: true,
        score,
        rawText,
        fields,
        topCandidates: {
          documentNumber: documentNumber.topCandidates,
          documentType: documentType.topCandidates,
          issueDate: issueDate.topCandidates,
          loadingWarehouseName: loadingWarehouseName.topCandidates,
          receiverEntity: receiverEntity.topCandidates,
          vehicleNumber: vehicleNumber.topCandidates,
          driverName: driverName.topCandidates,
          suppliedQuantityLiters: suppliedQuantityLiters.topCandidates,
        },
      };

      attempts.push(reviewAttempt);
      if (!best || score > best.score) {
        best = reviewAttempt;
      }

      if (isGoodEnough(fields, score)) {
        break;
      }
    } catch (error) {
      attempts.push({
        attempt,
        success: false,
        score: 0,
        rawText: '',
        message: error.message,
      });
    }
  }

  if (!best) {
    return {
      available: true,
      success: false,
      message: 'تعذر استخراج بيانات واضحة عبر الذكاء الاصطناعي',
      fields: {},
      attempts,
      topCandidates: {},
      score: 0,
      model: DEFAULT_MODEL,
    };
  }

  return {
    available: true,
    success: true,
    message: '',
    fields: best.fields,
    topCandidates: best.topCandidates,
    attempts,
    bestAttempt: best.attempt,
    score: best.score,
    model: DEFAULT_MODEL,
    source: 'document_ai',
  };
}

module.exports = {
  runUnloadingDocumentAiReview,
};
