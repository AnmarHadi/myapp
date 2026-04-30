// النسخة المحسّنة - Gemini Vision مباشر بدون قوالب

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

const GEMINI_MODEL =
  process.env.UNLOADING_GEMINI_MODEL || 'gemini-2.5-flash';
const CANONICAL_RECEIVER =
  'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

// helpers
function cleanString(v = '') {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1.0001) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function parseJsonSafe(text = '') {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue with best-effort JSON extraction below.
  }
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(text.slice(s, e + 1));
    } catch (_) {
      // Ignore malformed model output.
    }
  }
  return null;
}

function extractFirstJson(payload = {}) {
  for (const c of payload.candidates || []) {
    for (const p of c?.content?.parts || []) {
      if (typeof p?.text === 'string') {
        const r = parseJsonSafe(p.text);
        if (r) return r;
      }
    }
  }
  return null;
}

function extractText(payload = {}) {
  for (const c of payload.candidates || []) {
    for (const p of c?.content?.parts || []) {
      if (typeof p?.text === 'string' && p.text.trim()) return p.text.trim();
    }
  }
  return '';
}

function normalizeQuantity(v = '') {
  const w = String(v || '').replace(/[\u0660-\u0669]/g,
    (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
  const nums = (w.match(/\d{3,6}/g) || [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 60000);
  return nums.length ? String(nums.sort((a, b) => b - a)[0]) : '';
}

function normalizeFields(raw = {}) {
  const receiverRaw = repairBrokenWords(cleanString(raw.receiverEntity || ''));
  return {
    documentNumber:
      normalizeDocumentNumber(raw.documentNumber || '') || '',
    documentType:
      canonicalDocumentType(raw.documentType || '') || '',
    issueDate:
      normalizeDateValue(raw.issueDate || '') || '',
    loadingWarehouseName: sanitizeWarehouseName(
      sanitizeWarehouseStrictValue(raw.loadingWarehouseName || '')
    ),
    receiverEntity: isGoldenRefinery(receiverRaw)
      ? (canonicalReceiverEntity(receiverRaw, '') || CANONICAL_RECEIVER)
      : receiverRaw,
    vehicleNumber: canonicalVehicleValue(raw.vehicleNumber || ''),
    driverName: sanitizeDriverName(raw.driverName || ''),
    suppliedQuantityLiters: normalizeQuantity(
      raw.suppliedQuantityLiters || ''
    ),
    rawText: cleanString(raw.rawText || ''),
    fieldConfidence: {
      documentNumber: clamp01(raw.fieldConfidence?.documentNumber, 0.6),
      documentType: clamp01(raw.fieldConfidence?.documentType, 0.6),
      issueDate: clamp01(raw.fieldConfidence?.issueDate, 0.6),
      loadingWarehouseName: clamp01(
        raw.fieldConfidence?.loadingWarehouseName,
        0.6
      ),
      receiverEntity: clamp01(raw.fieldConfidence?.receiverEntity, 0.6),
      vehicleNumber: clamp01(raw.fieldConfidence?.vehicleNumber, 0.6),
      driverName: clamp01(raw.fieldConfidence?.driverName, 0.55),
      suppliedQuantityLiters: clamp01(
        raw.fieldConfidence?.suppliedQuantityLiters,
        0.6
      ),
    },
  };
}

function buildScore(f = {}) {
  let s = 0;
  if (f.documentNumber) s += 6;
  if (f.documentType) s += 5;
  if (f.issueDate) s += 4;
  if (f.loadingWarehouseName) s += 5;
  if (f.receiverEntity) s += 6;
  if (f.vehicleNumber) s += 6;
  if (f.driverName) s += 4;
  if (f.suppliedQuantityLiters) s += 2;
  s += Object.values(f.fieldConfidence || {}).reduce(
    (acc, v) => acc + clamp01(v, 0),
    0
  );
  return Number(s.toFixed(3));
}

function buildJsonSchema() {
  const strProp = { type: 'string' };
  const numProp = { type: 'number' };
  const confProps = {
    documentNumber: numProp,
    documentType: numProp,
    issueDate: numProp,
    loadingWarehouseName: numProp,
    receiverEntity: numProp,
    vehicleNumber: numProp,
    driverName: numProp,
    suppliedQuantityLiters: numProp,
  };

  return {
    type: 'object',
    properties: {
      documentNumber: strProp,
      documentType: strProp,
      issueDate: strProp,
      loadingWarehouseName: strProp,
      receiverEntity: strProp,
      vehicleNumber: strProp,
      driverName: strProp,
      suppliedQuantityLiters: strProp,
      rawText: strProp,
      fieldConfidence: {
        type: 'object',
        properties: confProps,
        required: Object.keys(confProps),
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

// المرحلة 1: استخراج النص الخام
async function extractRawText({ imageBuffer, mimeType, apiKey }) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    system_instruction: {
      parts: [{
        text: 'أنت محلل وثائق عراقية متخصص في مستندات نفط OPDC. مهمتك استخراج النص بدقة تامة مع الحفاظ على الأرقام والأسماء.',
      }],
    },
    contents: [{
      role: 'user',
      parts: [
        {
          text: `اقرأ هذا المستند العراقي بعناية واستخرج كل النصوص المرئية كما هي بالضبط.
- الأرقام: اكتبها بالأرقام الإنجليزية كما تظهر.
- النصوص العربية: احتفظ بها كاملة.
- رقم المستند: يبدأ بـ A ثم أرقام (مثال: A28193322) موجود عادةً تحت شعار OPDC.
- رقم السيارة: مثل 17668/21B أو 10464/أ نجف.
- الشكل الهندسي قرب QR (خماسي/دائري/رباعي/سداسي) يحدد نوع الوثيقة.
أعد النص كاملاً منسقاً وواضحاً.`,
        },
        {
          inline_data: {
            mime_type: mimeType || 'image/jpeg',
            data: imageBuffer.toString('base64'),
          },
        },
      ],
    }],
    generationConfig: { temperature: 0 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini pass1 failed: ${res.status}`);
  return extractText(await res.json());
}

// المرحلة 2: استخراج الحقول المنظمة من النص
async function extractFieldsFromText({ rawText, imageBuffer, mimeType, apiKey }) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `بناءً على النص المستخرج التالي من مستند تفريغ عراقي، استخرج الحقول المطلوبة بدقة.

=== النص المستخرج ===
${rawText}
=== نهاية النص ===

قواعد دقيقة لكل حقل:
• documentNumber: رقم يبدأ بـ A ثم 8 أرقام مثل "A28193322". موجود تحت شعار OPDC. لا تتركه فارغاً إذا ظهر.
• documentType: واحد فقط من هذه القيم: "68ا" (شكل خماسي) | "68ب" (شكل دائري) | "68ج" (شكل رباعي) | "126 تصديري" (شكل سداسي). اقرأه من الشكل الهندسي قرب رمز QR أو الشعار.
• issueDate: تاريخ الإصدار بصيغة YYYY-MM-DD فقط.
• loadingWarehouseName: الجهة المجهزة من الجدول العلوي الأيمن فقط (المصدر/المورد).
• receiverEntity: الجهة المستلمة/المرسل إليها من الجدول العلوي الأيمن (المستهلك).
• vehicleNumber: رقم السيارة كما هو مكتوب (مثل "17668/21B" أو "10464/أ نجف"). لا تتغير الأحرف.
• driverName: اسم السائق من سطر "اسم السائق" أسفل المستند فقط. لا تأخذ اسم موظف التجهيز.
• suppliedQuantityLiters: كمية "طبيعي (لتر)" من الجدول الأوسط بالأرقام الإنجليزية.
• rawText: النص الكامل المستخرج أعلاه.
• fieldConfidence: ثقتك في كل حقل من 0 إلى 1.`;

  const parts = [{ text: prompt }];
  if (imageBuffer) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBuffer.toString('base64'),
      },
    });
  }

  const body = {
    system_instruction: {
      parts: [{
        text: 'أنت محلل وثائق نفطية عراقية خبير. أعد JSON فقط بدون أي نص إضافي.',
      }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: buildJsonSchema(),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini pass2 failed: ${res.status}`);
  return extractFirstJson(await res.json());
}

async function runUnloadingGeminiReview({ imageBuffer, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
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

  let rawText = '';
  try {
    rawText = await extractRawText({ imageBuffer, mimeType, apiKey });
  } catch (err) {
    console.warn(
      '[GeminiExtractor] pass1 failed, falling back to pass2 only:',
      err.message
    );
  }

  let parsed = null;
  try {
    parsed = await extractFieldsFromText({
      rawText,
      imageBuffer,
      mimeType,
      apiKey,
    });
  } catch (err) {
    return {
      available: true,
      success: false,
      message: `فشل استخراج الحقول: ${err.message}`,
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
      message: 'تعذر تفسير استجابة Gemini',
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

  const fields = normalizeFields(parsed);
  const score = buildScore(fields);

  if (score < 20 && rawText) {
    try {
      const retryParsed = await extractFieldsFromText({
        rawText,
        imageBuffer: null,
        mimeType,
        apiKey,
      });
      if (retryParsed) {
        retryParsed.rawText = rawText;
        const retryFields = normalizeFields(retryParsed);
        const retryScore = buildScore(retryFields);
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
      // Continue with the first successful result.
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
