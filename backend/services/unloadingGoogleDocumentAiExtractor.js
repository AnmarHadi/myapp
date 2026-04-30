const fs = require('fs/promises');
const crypto = require('crypto');
const axios = require('axios');

const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName,
  cleanValue,
  normalizeTextKey,
} = require('./unloadingFieldReader');
const { isGoldenRefinery, repairBrokenWords } = require('./arabicFuzzy');
const { canonicalVehicleValue, sanitizeWarehouseStrictValue } = require('./unloadingStrictChecks');

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_LOCATION = process.env.GOOGLE_DOCUMENT_AI_LOCATION || 'us';
const DEFAULT_PROJECT_ID =
  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
const DEFAULT_PROCESSOR_ID = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID || '';
const DEFAULT_PROCESSOR_VERSION = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION || '';
const DEFAULT_MODEL = 'google_document_ai';
const CANONICAL_RECEIVER =
  'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';

let cachedCredentials = null;
let cachedToken = null;
let cachedTokenExpiry = 0;

function cleanString(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) return Math.max(0, Math.min(1, number / 100));
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
  if (field === 'vehicleNumber') return canonicalVehicleValue(value || '');
  if (field === 'driverName') return sanitizeDriverName(value || '');
  if (field === 'suppliedQuantityLiters') return normalizeQuantity(value || '');
  return cleanString(value);
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

function countUsefulFields(fields = {}) {
  return [
    fields.documentNumber,
    fields.documentType,
    fields.issueDate,
    fields.loadingWarehouseName,
    fields.receiverEntity,
    fields.vehicleNumber,
  ].filter(Boolean).length;
}

function extractTextFromAnchor(documentText = '', textAnchor = {}) {
  const text = String(documentText || '');
  const segments = Array.isArray(textAnchor?.textSegments) ? textAnchor.textSegments : [];
  if (!segments.length) return '';
  return segments
    .map((segment) => {
      const startIndex = Number(segment?.startIndex || 0);
      const endIndex = Number(segment?.endIndex || text.length);
      return text.slice(startIndex, endIndex);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(value = '') {
  return cleanValue(String(value || '').replace(/[\u200f\u200e]/g, ' '));
}

function cleanWarehouseCandidate(value = '') {
  return cleanString(String(value || ''))
    .replace(/^(?:الجهة\s*(?:المجهزة|المجهزه)|جهة\s*التجهيز|مستودع\s*التحميل)\s*[:：\-]?\s*/u, '')
    .replace(/\b(?:تاريخ\s*الإصدار|تاريخ\s*الاصدار|الجهة\s*المرسل\s*إليها|الجهة\s*المرسل\s*اليها|رقم\s*السيارة|رقم\s*المركبة|نوع\s*المستند|اسم\s*السائق)\b.*$/u, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestWarehouseCandidate(...values) {
  const scored = values
    .map((value) => cleanWarehouseCandidate(value))
    .filter(Boolean)
    .map((value) => {
      const score =
        (/(مستودع|مصفى|مصفاة)/.test(value) ? 3 : 0) +
        (/(الشعبية|السماوة|السماؤة|النجف|الناصرية|الشعيبة|الاسفلت|الأسفلت)/.test(value) ? 2 : 0) +
        Math.min(value.length / 20, 2);
      return { value, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.value || '';
}

function addHint(store, field, value, confidence = 0.75, source = 'raw') {
  const normalized = normalizeFieldValue(field, value);
  if (!normalized) return;
  const current = store[field];
  const next = {
    value: normalized,
    confidence: Number(clamp01(confidence, 0.75).toFixed(3)),
    source,
  };
  if (!current || next.confidence > current.confidence) {
    store[field] = next;
  }
}

function extractBetweenLabels(rawText = '', startLabels = [], endLabels = []) {
  const source = cleanString(String(rawText || ''));
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

function extractRawTextHints(rawText = '') {
  const source = cleanString(rawText);
  if (!source) return {};

  const hints = {};
  addHint(
    hints,
    'documentNumber',
    extractDocumentNumberFromRawText(source),
    0.8,
    'raw'
  );
  addHint(
    hints,
    'issueDate',
    extractBetweenLabels(source, ['تاريخ الإصدار', 'تاريخ الاصدار'], ['الجهة المجهزة', 'الجهة المرسل إليها']) ||
      extractFirstDate(source),
    0.78,
    'raw'
  );
  addHint(
    hints,
    'loadingWarehouseName',
    pickBestWarehouseCandidate(
      extractBetweenLabels(
        source,
        ['الجهة المجهزة', 'الجهة المجھزة', 'الجهة المجهزه'],
        ['تاريخ الإصدار', 'الجهة المرسل إليها', 'رقم السيارة', 'رقم المركبة']
      ),
      extractBetweenLabels(
        source,
        ['الجهة المجهزة:', 'الجهة المجهزة -', 'الجهة المجهزة/'],
        ['تاريخ الإصدار', 'الجهة المرسل إليها', 'رقم السيارة', 'رقم المركبة']
      ),
      extractBetweenLabels(
        source,
        ['مستودع التحميل', 'جهة التجهيز'],
        ['تاريخ الإصدار', 'الجهة المرسل إليها', 'رقم السيارة', 'رقم المركبة']
      )
    ),
    0.74,
    'raw'
  );
  addHint(
    hints,
    'receiverEntity',
    extractBetweenLabels(
      source,
      ['الجهة المرسل إليها', 'الجهة المرسل اليها'],
      ['رقم السيارة', 'رقم المركبة', 'نوع المنتوج', 'نوع المستند']
    ),
    0.74,
    'raw'
  );
  addHint(
    hints,
    'vehicleNumber',
    extractBetweenLabels(
      source,
      ['رقم السيارة', 'رقم المركبة'],
      ['نوع المنتوج', 'زيت الوقود', 'الكمية المجهزة', 'اسم السائق']
    ),
    0.74,
    'raw'
  );
  addHint(
    hints,
    'driverName',
    extractBetweenLabels(
      source,
      ['اسم السائق'],
      ['اسم الام', 'اسم الأم', 'رقم الهوية', 'تاريخ الهوية']
    ),
    0.7,
    'raw'
  );
  addHint(
    hints,
    'suppliedQuantityLiters',
    extractBetweenLabels(
      source,
      ['الكمية المجهزة', 'الكمية المجهزة (لتر)', 'طبيعي (لتر)', 'طبيعي(لتر)'],
      ['قياسي (لتر)', 'وزني (كغم)', 'درجة الحرارة', 'نسبة الشوائب']
    ),
    0.72,
    'raw'
  );
  addHint(
    hints,
    'documentType',
    source.match(/\b(68[اأاببج]|126\s*تصدير|126\s*تصديري)\b/)?.[1] || '',
    0.78,
    'raw'
  );
  return hints;
}

function extractHintsFromFormFields(document = {}) {
  const hints = {};
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const text = String(document.text || '');

  for (const page of pages) {
    const formFields = Array.isArray(page?.formFields) ? page.formFields : [];
    for (const field of formFields) {
      const label = normalizeLabel(
        extractTextFromAnchor(text, field?.fieldName?.textAnchor) ||
        field?.fieldName?.normalizedValue?.text ||
        field?.fieldName?.text ||
        ''
      );
      const value = normalizeLabel(
        extractTextFromAnchor(text, field?.fieldValue?.textAnchor) ||
        field?.fieldValue?.normalizedValue?.text ||
        field?.fieldValue?.text ||
        ''
      );
      if (!label || !value) continue;

      if (/(رقم\s*المستند|رقم\s*الوثيقة|رقم\s*الاصدار|رقم\s*الإصدار)/.test(label)) {
        addHint(hints, 'documentNumber', value, 0.95, 'form');
      }
      if (/(نوع\s*المستند|نوع\s*الوثيقة|document\s*type)/i.test(label)) {
        addHint(hints, 'documentType', value, 0.9, 'form');
      }
      if (/(تاريخ\s*الإصدار|تاريخ\s*الاصدار|تاريخ\s*المنشأ)/.test(label)) {
        addHint(hints, 'issueDate', value, 0.95, 'form');
      }
      if (/(الجهة\s*المجهزة|الجهة\s*المجهزه|جهة\s*التجهيز|مستودع\s*التحميل)/.test(label)) {
        addHint(hints, 'loadingWarehouseName', cleanWarehouseCandidate(value), 0.99, 'form');
      }
      if (/(الجهة\s*المرسل\s*إليها|الجهة\s*المرسل\s*اليها|الجهة\s*المستلمة)/.test(label)) {
        addHint(hints, 'receiverEntity', value, 0.96, 'form');
      }
      if (/(رقم\s*السيارة|رقم\s*المركبة|vehicle\s*number)/i.test(label)) {
        addHint(hints, 'vehicleNumber', value, 0.95, 'form');
      }
      if (/(اسم\s*السائق|السائق)/.test(label)) {
        addHint(hints, 'driverName', value, 0.95, 'form');
      }
      if (/(الكمية\s*المجهزة|طبيعي\s*\(لتر\)|الكمية|supplied\s*quantity)/i.test(label)) {
        addHint(hints, 'suppliedQuantityLiters', value, 0.9, 'form');
      }
    }
  }

  const entities = Array.isArray(document.entities) ? document.entities : [];
  for (const entity of entities) {
    const type = normalizeTextKey(String(entity?.type || entity?.type_ || ''));
    const value =
      cleanValue(entity?.mentionText || '') ||
      cleanValue(entity?.normalizedValue?.text || '') ||
      cleanValue(entity?.normalizedValue?.moneyValue?.amount || '') ||
      cleanValue(entity?.normalizedValue?.dateValue?.normalizedValue || '');
    if (!type || !value) continue;

    if (/(document.*number|رقم.*مستند|رقم.*وثيقة)/.test(type)) addHint(hints, 'documentNumber', value, 0.92, 'entity');
    if (/(document.*type|نوع.*مستند|نوع.*وثيقة)/.test(type)) addHint(hints, 'documentType', value, 0.9, 'entity');
    if (/(issue.*date|تاريخ.*اصدار|تاريخ.*إصدار)/.test(type)) addHint(hints, 'issueDate', value, 0.92, 'entity');
    if (/(loading.*warehouse|warehouse|جهة.*مجهزة|مستودع|مصفى|مصفى|مصفاة)/.test(type)) {
      addHint(hints, 'loadingWarehouseName', cleanWarehouseCandidate(value), 0.9, 'entity');
    }
    if (/(receiver|entity|الجهة.*المرسل)/.test(type)) addHint(hints, 'receiverEntity', value, 0.9, 'entity');
    if (/(vehicle.*number|plate|car|مركبة|سيارة)/.test(type)) addHint(hints, 'vehicleNumber', value, 0.9, 'entity');
    if (/(driver|سائق)/.test(type)) addHint(hints, 'driverName', value, 0.9, 'entity');
    if (/(quantity|كمية)/.test(type)) addHint(hints, 'suppliedQuantityLiters', value, 0.85, 'entity');
  }

  return hints;
}

async function loadServiceAccount() {
  if (cachedCredentials) return cachedCredentials;

  const inline = process.env.GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    cachedCredentials = JSON.parse(inline);
    return cachedCredentials;
  }

  const credentialsPath =
    process.env.GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    '';

  if (!credentialsPath) return null;
  const absolutePath = credentialsPath.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(credentialsPath)
    ? credentialsPath
    : credentialsPath;
  const raw = await fs.readFile(absolutePath, 'utf8');
  cachedCredentials = JSON.parse(raw);
  return cachedCredentials;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(claims, privateKey) {
  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedClaims = base64Url(JSON.stringify(claims));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedClaims}`);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');
  return `${encodedHeader}.${encodedClaims}.${base64Url(signature)}`;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExpiry > now + 60) {
    return cachedToken;
  }

  const credentials = await loadServiceAccount();
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Google Document AI service account is not configured');
  }

  const assertion = signJwt(
    {
      iss: credentials.client_email,
      scope: GOOGLE_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    credentials.private_key.replace(/\\n/g, '\n')
  );

  const tokenResponse = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    }
  );

  cachedToken = tokenResponse.data?.access_token || '';
  cachedTokenExpiry = now + Number(tokenResponse.data?.expires_in || 3600);
  if (!cachedToken) {
    throw new Error('Google OAuth token was not returned');
  }
  return cachedToken;
}

function getProcessorPath() {
  if (!DEFAULT_PROJECT_ID) return '';
  if (DEFAULT_PROCESSOR_VERSION) {
    return `projects/${DEFAULT_PROJECT_ID}/locations/${DEFAULT_LOCATION}/processors/${DEFAULT_PROCESSOR_ID}/processorVersions/${DEFAULT_PROCESSOR_VERSION}`;
  }
  return `projects/${DEFAULT_PROJECT_ID}/locations/${DEFAULT_LOCATION}/processors/${DEFAULT_PROCESSOR_ID}`;
}

function buildFields(raw = {}, hints = {}) {
  const merged = {};
  const keys = [
    'documentNumber',
    'documentType',
    'issueDate',
    'loadingWarehouseName',
    'receiverEntity',
    'vehicleNumber',
    'driverName',
    'suppliedQuantityLiters',
  ];

  for (const key of keys) {
    const hint = hints[key]?.value || '';
    const rawValue = raw[key] || '';
    const normalized = normalizeFieldValue(key, hint || rawValue);
    merged[key] = normalized;
    merged[`${key}Confidence`] = clamp01(hints[key]?.confidence, normalized ? 0.7 : 0.25);
  }

  const receiverRaw = repairBrokenWords(merged.receiverEntity || '');
  merged.receiverEntity = isGoldenRefinery(receiverRaw)
    ? (canonicalReceiverEntity(receiverRaw, '') || CANONICAL_RECEIVER)
    : receiverRaw;

  return {
    documentNumber: merged.documentNumber || '',
    documentType: merged.documentType || '',
    issueDate: merged.issueDate || '',
    loadingWarehouseName: merged.loadingWarehouseName || '',
    receiverEntity: merged.receiverEntity || '',
    vehicleNumber: merged.vehicleNumber || '',
    driverName: merged.driverName || '',
    suppliedQuantityLiters: merged.suppliedQuantityLiters || '',
    rawText: cleanString(raw.rawText || ''),
    fieldConfidence: {
      documentNumber: merged.documentNumberConfidence || 0,
      documentType: merged.documentTypeConfidence || 0,
      issueDate: merged.issueDateConfidence || 0,
      loadingWarehouseName: merged.loadingWarehouseNameConfidence || 0,
      receiverEntity: merged.receiverEntityConfidence || 0,
      vehicleNumber: merged.vehicleNumberConfidence || 0,
      driverName: merged.driverNameConfidence || 0,
      suppliedQuantityLiters: merged.suppliedQuantityLitersConfidence || 0,
    },
  };
}

async function processGoogleDocumentAi({ imageBuffer, mimeType }) {
  const processorPath = getProcessorPath();
  if (!processorPath || !DEFAULT_PROJECT_ID || !DEFAULT_LOCATION || !DEFAULT_PROCESSOR_ID) {
    return {
      available: false,
      success: false,
      message: 'Google Document AI is not configured',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: DEFAULT_MODEL,
      source: 'google_document_ai',
    };
  }

  const accessToken = await getAccessToken();
  const url = `https://${DEFAULT_LOCATION}-documentai.googleapis.com/v1/${processorPath}:process`;
  const response = await axios.post(
    url,
    {
      rawDocument: {
        content: imageBuffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg',
      },
      skipHumanReview: true,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  return response.data?.document || response.data || {};
}

async function runUnloadingGoogleDocumentAiReview({ imageBuffer, mimeType }) {
  try {
    const document = await processGoogleDocumentAi({ imageBuffer, mimeType });
    const rawText = cleanString(document?.text || '');
    const formHints = extractHintsFromFormFields(document);
    const rawHints = extractRawTextHints(rawText);
    const hints = { ...rawHints, ...formHints };

    const raw = {
      documentNumber: hints.documentNumber?.value || '',
      documentType: hints.documentType?.value || '',
      issueDate: hints.issueDate?.value || '',
      loadingWarehouseName: hints.loadingWarehouseName?.value || '',
      receiverEntity: hints.receiverEntity?.value || '',
      vehicleNumber: hints.vehicleNumber?.value || '',
      driverName: hints.driverName?.value || '',
      suppliedQuantityLiters: hints.suppliedQuantityLiters?.value || '',
      rawText,
    };

    const fields = buildFields(raw, hints);
    const score = buildScore(fields);
    const usefulFieldCount = countUsefulFields(fields);
    const success = Boolean(rawText) && usefulFieldCount >= 4;

    return {
      available: true,
      success,
      message: success ? '' : 'Google Document AI returned limited fields',
      fields,
      attempts: [
        {
          attempt: 1,
          success,
          score,
        },
      ],
      bestAttempt: 1,
      score,
      topCandidates: {
        documentNumber: hints.documentNumber ? [hints.documentNumber] : [],
        documentType: hints.documentType ? [hints.documentType] : [],
        issueDate: hints.issueDate ? [hints.issueDate] : [],
        loadingWarehouseName: hints.loadingWarehouseName ? [hints.loadingWarehouseName] : [],
        receiverEntity: hints.receiverEntity ? [hints.receiverEntity] : [],
        vehicleNumber: hints.vehicleNumber ? [hints.vehicleNumber] : [],
        driverName: hints.driverName ? [hints.driverName] : [],
        suppliedQuantityLiters: hints.suppliedQuantityLiters ? [hints.suppliedQuantityLiters] : [],
      },
      model: processorPathLabel(),
      source: 'google_document_ai',
    };
  } catch (error) {
    return {
      available: true,
      success: false,
      message: error.message || 'Google Document AI failed',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: processorPathLabel(),
      source: 'google_document_ai',
    };
  }
}

function processorPathLabel() {
  return getProcessorPath() || DEFAULT_MODEL || 'google_document_ai';
}

module.exports = {
  runUnloadingGoogleDocumentAiReview,
};
