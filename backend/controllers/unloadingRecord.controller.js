/* eslint-disable consistent-return */
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const QRCode = require('qrcode');

const UnloadingRecord = require('../models/UnloadingRecord');
const LoadingWarehouse = require('../models/LoadingWarehouse');
const LoadingDestination = require('../models/LoadingDestination');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const TripPricing = require('../models/TripPricing');

const { runEasyOcr } = require('../services/unloadingEasyOcrBridge');
const { runUnloadingVisionReview } = require('../services/unloadingVisionVerifier');
const { runUnloadingGoogleDocumentAiReview } = require('../services/unloadingGoogleDocumentAiExtractor');
const { runUnloadingDocumentAiReview: runUnloadingLegacyDocumentAiReview } = require('../services/unloadingDocumentAiService');
const { runUnloadingOpenAiReview } = require('../services/unloadingOpenAiExtractor');
const { runUnloadingGeminiReview } = require('../services/unloadingGeminiExtractor');
const { mergeVisionReviews } = require('../services/visionReviewMerger');
const { isGoldenRefinery, repairBrokenWords } = require('../services/arabicFuzzy');
const {
  buildUnloadingStrictChecks,
  blockingErrorsFromStrictChecks,
  normalizeWarehouseCandidate: normalizeWarehouseCandidateForStrict,
  canonicalVehicleValue,
} = require('../services/unloadingStrictChecks');

const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName,
  cleanValue,
  normalizeTextKey,
} = require('../services/unloadingFieldReader');

const escapeRegex = (v = '') => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CANONICAL_RECEIVER_ENTITY = 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
const LOADING_WAREHOUSE_ALLOWLIST = [
  'شركة الشبكة الذهبية',
  'شركة الشبكة الذهبية القابضة',
  'الشبكة الذهبية',
  'الشبكة الذهبية القابضة',
  'مصفى النفط الذهبي',
  'مصفاة النفط الذهبي',
];

function createEmptyExtractionResult() {
  return {
    documentType: '',
    documentNumber: '',
    loadingWarehouseName: '',
    issueDate: '',
    receiverEntity: '',
    receiverEntityValid: false,
    receiverEntityWarning: '',
    vehicleNumberRaw: '',
    vehicleNumber: '',
    vehicleGovernorate: '',
    driverName: '',
    suppliedQuantityLiters: 0,
    rawText: '',
    ocrMatches: {},
    meta: {},
  };
}

async function safeReviewCall(label, runner) {
  try {
    return await runner();
  } catch (error) {
    console.warn(`[extract] ${label} failed:`, error);
    return {
      available: false,
      success: false,
      message: error?.message || `${label} failed`,
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
      source: label,
    };
  }
}

function pickBestVisionReview(reviews = []) {
  const ordered = Array.isArray(reviews) ? reviews : [];
  const scored = ordered
    .map((item) => ({
      item,
      score: scoreVisionReview(item),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item || ordered[0] || {
    available: false,
    success: false,
    message: '',
    fields: {},
    attempts: [],
    topCandidates: {},
    score: 0,
    model: '',
    source: '',
  };
}

function scoreVisionReview(review = {}) {
  const fields = review?.fields || {};
  const fieldValues = [
    fields.documentNumber,
    fields.documentType,
    fields.issueDate,
    fields.loadingWarehouseName,
    fields.receiverEntity,
    fields.vehicleNumber,
    fields.driverName,
    fields.productType,
    fields.suppliedQuantityLiters,
  ].filter((value) => cleanValue(value || '').length);

  let score = Number(review?.score || 0);
  if (review?.success) score += 10;
  score += fieldValues.length * 1.2;
  score += Array.isArray(review?.attempts) ? review.attempts.length * 0.4 : 0;
  score += Number(review?.fields?.fieldConfidence?.vehicleNumber || 0) * 2;
  score += Number(review?.fields?.fieldConfidence?.driverName || 0) * 1.8;
  score += Number(review?.fields?.fieldConfidence?.loadingWarehouseName || 0) * 1.8;
  score += Number(review?.fields?.fieldConfidence?.receiverEntity || 0) * 1.8;
  score += Number(review?.fields?.fieldConfidence?.documentNumber || 0) * 1;
  score += Number(review?.fields?.fieldConfidence?.issueDate || 0) * 0.8;
  return score;
}

function buildVisionReviewTasks(req = {}) {
  const imageBuffer = req.file?.buffer;
  const mimeType = req.file?.mimetype;

  return [
    {
      label: 'google_document_ai',
      run: () => runUnloadingGoogleDocumentAiReview({ imageBuffer, mimeType }),
    },
    {
      label: 'openai_document_ai',
      run: () => runUnloadingOpenAiReview({ imageBuffer, mimeType }),
    },
    {
      label: 'gemini_document_ai',
      run: () => runUnloadingGeminiReview({ imageBuffer, mimeType }),
    },
    {
      label: 'document_ai',
      run: () => runUnloadingLegacyDocumentAiReview({ imageBuffer, mimeType }),
    },
    {
      label: 'vision',
      run: () => runUnloadingVisionReview({ imageBuffer, mimeType }),
    },
  ];
}

async function runPrioritizedVisionReview(tasks = [], { registrationMode = 'unloading' } = {}) {
  const reviews = [];

  for (const task of tasks) {
    const review = await safeReviewCall(task.label, task.run);
    reviews.push(review);
  }

  return {
    review: mergeVisionReviews(reviews, { registrationMode }),
    reviews,
  };
}

function levenshtein(a = '', b = '') {
  const s = [...String(a)];
  const t = [...String(b)];
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));

  for (let i = 0; i <= s.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[s.length][t.length];
}

function driverMatchScore(input = '', candidate = '') {
  const a = normalizeTextKey(sanitizeDriverName(input));
  const b = normalizeTextKey(sanitizeDriverName(candidate));

  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.96;

  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  const commonParts = aParts.filter((part) => bParts.includes(part));
  const overlapScore = commonParts.length / Math.max(Math.min(aParts.length, bParts.length), 1);

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  const editScore = 1 - (distance / maxLen);

  return Math.max(
    editScore,
    overlapScore,
    commonParts.length >= 2 ? 0.9 : 0
  );
}

function normalizeReceiverSearchText(value = '') {
  return String(value || '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FF0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReceiverEntityAccepted(value = '') {
  return isGoldenRefinery(value);
}

function getRegistrationMode(req = {}) {
  const source = cleanValue(
    req.registrationMode
      || req.body?.registrationMode
      || req.query?.registrationMode
      || req.body?.mode
      || req.query?.mode
      || ''
  ).toLowerCase();
  return source === 'loading' ? 'loading' : 'unloading';
}

function isLoadingWarehouseAllowed(value = '') {
  const key = normalizeTextKey(normalizeWarehouseCandidate(value || ''));
  if (!key) return false;
  return /(?:مصفى|مصفاة)\s*النفط\s*الذهبي/.test(key);
}

function filterWarehouseWhitelistByMode(warehouseWhitelist = [], mode = 'unloading') {
  if (mode !== 'loading') return warehouseWhitelist;
  return (Array.isArray(warehouseWhitelist) ? warehouseWhitelist : []).filter((item) =>
    isLoadingWarehouseAllowed(item?.name || '')
  );
}

function buildRegistrationModeFilter(mode = 'unloading') {
  if (mode === 'loading') {
    return { registrationMode: 'loading' };
  }

  return {
    $or: [
      { registrationMode: { $exists: false } },
      { registrationMode: 'unloading' },
    ],
  };
}

function getReceiverEntityWarning(receiverEntity = '') {
  if (!receiverEntity) {
    return 'تعذر التأكد من الجهة المرسل إليها من الصورة';
  }

  if (!isReceiverEntityAccepted(receiverEntity)) {
    return `الجهة المرسل إليها غير صحيحة: ${receiverEntity}`;
  }

  return '';
}

async function matchLoadingReceiverEntity(name = '') {
  const clean = cleanValue(name);
  if (!clean) return null;

  const key = normalizeTextKey(clean);

  let found = await LoadingDestination.findOne({ nameKey: key });
  if (found) return found;

  found = await LoadingDestination.findOne({
    name: { $regex: escapeRegex(clean), $options: 'i' },
  });
  if (found) return found;

  const candidates = await LoadingDestination.find({
    name: { $regex: escapeRegex(clean.slice(0, Math.max(2, Math.min(clean.length, 12)))), $options: 'i' },
  })
    .select('name governorate nameKey governorateKey')
    .limit(25);

  return (
    candidates.find((item) => {
      const a = normalizeTextKey(item.name || '');
      return a.includes(key) || key.includes(a);
    }) || null
  );
}

function extractLoadingReceiverPhraseFromRawText(rawText = '') {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);

  const labelPatterns = [
    /الجهة\s*المرسل\s*إليها(?:\s*المشتري)?/i,
    /الجهة\s*المرسلة\s*إليها(?:\s*المشتري)?/i,
    /الجهة\s*المرسل\s*اليها(?:\s*المشتري)?/i,
    /الجهة\s*المرسلة\s*اليها(?:\s*المشتري)?/i,
  ];

  const stripLabel = (line = '') => {
    let text = cleanValue(line);
    for (const pattern of labelPatterns) {
      text = text.replace(pattern, '');
    }
    text = text.replace(/^[:\-\/\s]+/, '').trim();
    return text;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const normalized = normalizeReceiverSearchText(line);
    if (!normalized) continue;

    if (normalized.includes('المنفذ الجنوبي البحري')) {
      return 'المنفذ الجنوبي البحري';
    }

    if (labelPatterns.some((pattern) => pattern.test(line))) {
      const currentTail = stripLabel(line);
      if (currentTail && currentTail.length >= 3) {
        return currentTail;
      }

      const nextLine = lines[i + 1] ? cleanValue(lines[i + 1]) : '';
      const nextNormalized = normalizeReceiverSearchText(nextLine);
      if (nextLine && nextNormalized && !labelPatterns.some((pattern) => pattern.test(nextLine))) {
        return nextLine;
      }
    }

    if ((normalized.includes('المشتري') || normalized.includes('الجهة')) && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ? cleanValue(lines[i + 1]) : '';
      const nextNormalized = normalizeReceiverSearchText(nextLine);
      if (nextLine && nextNormalized && !labelPatterns.some((pattern) => pattern.test(nextLine))) {
        return nextLine;
      }
    }
  }

  return '';
}

function normalizeWarehouseCandidate(value = '') {
  return normalizeWarehouseCandidateForStrict(value);
}

function normalizeDriverKey(value = '') {
  return normalizeTextKey(sanitizeDriverName(value || ''));
}

function toWesternDigits(value = '') {
  const map = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  return String(value || '').replace(/[٠-٩]/g, (d) => map[d] || d);
}

function toWesternDigitsSafe(value = '') {
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

function hasWarehouseKeyword(value = '') {
  return /(?:\u0645\u0633\u062a\u0648\u062f\u0639|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629)/.test(String(value || ''));
}

function clampConfidence(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1.0001) {
    return Math.max(0, Math.min(1, number / 100));
  }
  return Math.max(0, Math.min(1, number));
}

function toCandidateArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function mergeMatchSignals(baseMatch = {}, preferredValue = '', preferredConfidence = 0, externalCandidates = []) {
  const candidates = [];

  const pushCandidate = (value, confidence = 0.5) => {
    const cleaned = cleanValue(value || '');
    if (!cleaned) return;
    candidates.push({
      value: cleaned,
      confidence: Number(clampConfidence(confidence, 0.5).toFixed(3)),
    });
  };

  pushCandidate(preferredValue, preferredConfidence);

  for (const candidate of toCandidateArray(baseMatch?.candidates)) {
    if (typeof candidate === 'string') {
      pushCandidate(candidate, baseMatch?.confidence ?? 0.5);
    } else if (candidate && typeof candidate === 'object') {
      pushCandidate(candidate.value || candidate.bestValue || candidate.raw || '', candidate.confidence ?? baseMatch?.confidence ?? 0.5);
    }
  }

  for (const candidate of toCandidateArray(externalCandidates)) {
    if (typeof candidate === 'string') {
      pushCandidate(candidate, preferredConfidence || 0.5);
    } else if (candidate && typeof candidate === 'object') {
      pushCandidate(candidate.value || candidate.text || candidate.bestValue || '', candidate.confidence ?? preferredConfidence ?? 0.5);
    }
  }

  const dedup = new Map();
  for (const item of candidates) {
    const key = item.value.toLowerCase();
    const prev = dedup.get(key);
    if (!prev || item.confidence > prev.confidence) {
      dedup.set(key, item);
    }
  }

  return {
    ...baseMatch,
    confidence: Number(Math.max(
      clampConfidence(baseMatch?.confidence, 0),
      clampConfidence(preferredConfidence, 0)
    ).toFixed(3)),
    bestValue: preferredValue || baseMatch?.bestValue || '',
    candidates: Array.from(dedup.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6),
  };
}

function parseQuantityValue(value = '') {
  const digits = toWesternDigitsSafe(String(value || '')).match(/\d{3,6}/g) || [];
  const list = digits
    .map((item) => Number(item))
    .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 60000);
  if (!list.length) return 0;
  return list.sort((a, b) => b - a)[0];
}

function hasArabicNameShape(value = '') {
  const cleaned = sanitizeDriverName(value || '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/).filter((token) => /^[\u0621-\u064A]{2,}$/.test(token));
  return parts.length >= 3 && parts.length <= 6;
}

function hasDriverNoise(value = '') {
  return /(?:موظف\s*التجهيز|العنوان\s*الوظيفي|وقت\s*الإرسال|وقت\s*الارسال|التوقيع|اسم\s*الام|اسم\s*الأم|رقم\s*الهوية|تاريخ\s*الهوية)/i
    .test(String(value || ''));
}

function preferDriverValue(visionValue = '', ocrValue = '') {
  const v = hasDriverNoise(visionValue) ? '' : sanitizeDriverName(visionValue || '');
  const o = hasDriverNoise(ocrValue) ? '' : sanitizeDriverName(ocrValue || '');
  if (hasArabicNameShape(v)) return v;
  if (hasArabicNameShape(o)) return o;
  return v || o || '';
}

function toIdString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function preferWarehouseValue(visionValue = '', ocrValue = '') {
  const v = sanitizeWarehouseName(normalizeWarehouseCandidate(visionValue || ''));
  const o = sanitizeWarehouseName(normalizeWarehouseCandidate(ocrValue || ''));
  const warehousePattern = /(مستودع|مصفى|مصفاة)/;
  if (v && warehousePattern.test(v)) return v;
  if (o && warehousePattern.test(o)) return o;
  return v || o || '';
}

function preferWarehouseValueStrict(visionValue = '', ocrValue = '') {
  const v = sanitizeWarehouseName(normalizeWarehouseCandidate(visionValue || ''));
  const o = sanitizeWarehouseName(normalizeWarehouseCandidate(ocrValue || ''));
  if (v && hasWarehouseKeyword(v)) return v;
  if (o && hasWarehouseKeyword(o)) return o;
  return v || o || '';
}

function preferVehicleValue(visionValue = '', ocrValue = '', ocrRaw = '') {
  const visionArabic = parseArabicStyleVehicle(visionValue || '');
  if (visionArabic?.digits && visionArabic?.letter) {
    return visionArabic.display;
  }

  const visionCanonical = canonicalVehicleValue(visionValue || '');
  if (/^\d{2}[A-Z]\d{4,6}$/.test(visionCanonical)) return visionCanonical;

  const rawArabic = parseArabicStyleVehicle(ocrRaw || '');
  if (rawArabic?.digits && rawArabic?.letter) {
    return rawArabic.display;
  }

  const ocrArabic = parseArabicStyleVehicle(ocrValue || '');
  if (ocrArabic?.digits && ocrArabic?.letter) {
    return ocrArabic.display;
  }

  const o = canonicalVehicleValue(ocrValue || ocrRaw || '');
  if (/^\d{2}[A-Z]\d{4,6}$/.test(o)) return o;

  return visionCanonical || o || cleanValue(visionValue || ocrValue || '');
}

const IRAQI_GOVERNORATE_ALIASES = {
  بغداد: 'بغداد',
  البغداد: 'بغداد',
  بصرة: 'بصرة',
  البصرة: 'بصرة',
  البصره: 'بصرة',
  بصره: 'بصرة',
  بابل: 'بابل',
  حلة: 'بابل',
  حله: 'بابل',
  ذيقار: 'ذي قار',
  'ذي قار': 'ذي قار',
  النجف: 'نجف',
  نجف: 'نجف',
  كربلاء: 'كربلاء',
  كربلا: 'كربلاء',
  واسط: 'واسط',
  ميسان: 'ميسان',
  ديالى: 'ديالى',
  دهوك: 'دهوك',
  الانبار: 'الأنبار',
  الأنبار: 'الأنبار',
  اربيل: 'أربيل',
  أربيل: 'أربيل',
  نينوى: 'نينوى',
  السليمانية: 'السليمانية',
  سليمانية: 'السليمانية',
  القادسية: 'القادسية',
  المثنى: 'المثنى',
  صلاحالدين: 'صلاح الدين',
  'صلاح الدين': 'صلاح الدين',
  كركوك: 'كركوك',
};

function normalizeGovernorateName(value = '') {
  const cleaned = cleanValue(value);
  if (!cleaned) return '';
  const key = normalizeTextKey(cleaned).replace(/\s+/g, '');
  return IRAQI_GOVERNORATE_ALIASES[key] || cleanValue(cleaned.replace(/^ال/, '')) || '';
}

function normalizeArabicVehicleLetter(value = '') {
  const letter = String(value || '').trim();
  const map = {
    F: 'ف',
    f: 'ف',
    A: 'ا',
    a: 'ا',
    B: 'ب',
    b: 'ب',
    C: 'ج',
    c: 'ج',
  };
  return map[letter] || letter;
}

function parseArabicStyleVehicle(value = '') {
  const raw = cleanValue(toWesternDigitsSafe(value || ''));
  if (!raw) return null;

  const normalized = raw
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

  const governorateEntries = Object.entries(IRAQI_GOVERNORATE_ALIASES)
    .sort((a, b) => b[0].length - a[0].length);

  let governorate = '';
  let working = normalized;

  for (const [alias, canonical] of governorateEntries) {
    const aliasRegex = new RegExp(`(^|\\s|/)${escapeRegex(alias)}(?=\\s|/|$)`, 'i');
    if (aliasRegex.test(normalizeTextKey(working))) {
      governorate = canonical;
      working = cleanValue(
        working.replace(new RegExp(`(^|\\s|/)${escapeRegex(alias)}(?=\\s|/|$)`, 'ig'), ' ')
      );
      break;
    }
  }

  const direct = working.match(/^(\d{4,6})\/([\u0621-\u064A])$/);
  if (direct) {
    return {
      digits: direct[1],
      letter: normalizeArabicVehicleLetter(direct[2]),
      governorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(direct[2])}${direct[1]}`,
      display: `${direct[1]}/${normalizeArabicVehicleLetter(direct[2])}${governorate ? ` ${governorate}` : ''}`.trim(),
    };
  }

  const digitsFirst = working.match(/^(\d{4,6})\s+([\u0621-\u064A])$/);
  if (digitsFirst) {
    return {
      digits: digitsFirst[1],
      letter: normalizeArabicVehicleLetter(digitsFirst[2]),
      governorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(digitsFirst[2])}${digitsFirst[1]}`,
      display: `${digitsFirst[1]}/${normalizeArabicVehicleLetter(digitsFirst[2])}${governorate ? ` ${governorate}` : ''}`.trim(),
    };
  }

  const letterFirst = working.match(/^([\u0621-\u064A])\s*(\d{4,6})$/);
  if (letterFirst) {
    return {
      digits: letterFirst[2],
      letter: normalizeArabicVehicleLetter(letterFirst[1]),
      governorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(letterFirst[1])}${letterFirst[2]}`,
      display: `${letterFirst[2]}/${normalizeArabicVehicleLetter(letterFirst[1])}${governorate ? ` ${governorate}` : ''}`.trim(),
    };
  }

  const latinDigitsFirst = working.match(/^(\d{4,6})\s*([A-Za-z])(?:\s+([\u0600-\u06FF\s]+))?$/);
  if (latinDigitsFirst) {
    const letter = normalizeArabicVehicleLetter(latinDigitsFirst[2]);
    const latinGovernorate = normalizeGovernorateName(latinDigitsFirst[3] || governorate);
    return {
      digits: latinDigitsFirst[1],
      letter,
      governorate: latinGovernorate,
      vehicleNumber: `${letter}${latinDigitsFirst[1]}`,
      display: `${latinDigitsFirst[1]}/${letter}${latinGovernorate ? ` ${latinGovernorate}` : ''}`.trim(),
    };
  }

  const latinLetterFirst = working.match(/^([A-Za-z])\s*(\d{4,6})(?:\s+([\u0600-\u06FF\s]+))?$/);
  if (latinLetterFirst) {
    const letter = normalizeArabicVehicleLetter(latinLetterFirst[1]);
    const latinGovernorate = normalizeGovernorateName(latinLetterFirst[3] || governorate);
    return {
      digits: latinLetterFirst[2],
      letter,
      governorate: latinGovernorate,
      vehicleNumber: `${letter}${latinLetterFirst[2]}`,
      display: `${latinLetterFirst[2]}/${letter}${latinGovernorate ? ` ${latinGovernorate}` : ''}`.trim(),
    };
  }

  const embedded = normalized.match(/(\d{4,6})\s*\/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF\s]{2,}))?/);
  if (embedded) {
    const embeddedGovernorate = normalizeGovernorateName(embedded[3] || governorate);
    return {
      digits: embedded[1],
      letter: normalizeArabicVehicleLetter(embedded[2]),
      governorate: embeddedGovernorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(embedded[2])}${embedded[1]}`,
      display: `${embedded[1]}/${normalizeArabicVehicleLetter(embedded[2])}${embeddedGovernorate ? ` ${embeddedGovernorate}` : ''}`.trim(),
    };
  }

  return null;
}

function formatVehicleDisplay(vehicleNumber = '', governorate = '') {
  const number = cleanValue(vehicleNumber);
  const gov = normalizeGovernorateName(governorate);
  const compact = String(number || '').replace(/\s+/g, '').toUpperCase();

  const arabicParsed = parseArabicStyleVehicle(`${number} ${gov}`.trim()) || parseArabicStyleVehicle(number);
  if (arabicParsed?.digits && arabicParsed?.letter) {
    return arabicParsed.display;
  }

  const arabicCompact = cleanValue(toWesternDigitsSafe(number));
  const arabicNumberMatch = arabicCompact.match(/^([\u0621-\u064A])(\d{4,6})$/);
  if (arabicNumberMatch) {
    return `${arabicNumberMatch[2]}/${arabicNumberMatch[1]}${gov ? ` ${gov}` : ''}`.trim();
  }

  if (/^\d{4,6}\/\d{1,3}[A-Z]$/i.test(compact)) {
    const [, digits, prefix] = compact.match(/^(\d{4,6})\/(\d{1,3}[A-Z])$/i) || [];
    if (digits && prefix) return `${prefix.toUpperCase()}${digits}`;
  }

  if (/^\d{1,3}[A-Z]\/\d{4,6}$/i.test(compact)) {
    const [, prefix, digits] = compact.match(/^(\d{1,3}[A-Z])\/(\d{4,6})$/i) || [];
    if (digits && prefix) return `${prefix.toUpperCase()}${digits}`;
  }

  const embedded =
    compact.match(/(\d{4,6})\/(\d{1,3}[A-Z])/i) ||
    compact.match(/(\d{1,3}[A-Z])\/(\d{4,6})/i);
  if (embedded) {
    const [_, a, b] = embedded;
    if (/^\d{4,6}$/.test(a) && /^\d{1,3}[A-Z]$/i.test(b)) return `${b.toUpperCase()}${a}`;
    if (/^\d{1,3}[A-Z]$/i.test(a) && /^\d{4,6}$/.test(b)) return `${a.toUpperCase()}${b}`;
  }

  if (number && /^\d{1,3}[A-Z]$/i.test(gov)) {
    return `${gov.toUpperCase()}${number}`;
  }

  if (number && gov) return `${number}/${gov}`;
  return number || gov || '';
}

function formatVehicleAsDocument(rawValue = '', canonicalOrDbValue = '', governorate = '') {
  const raw = cleanValue(toWesternDigitsSafe(rawValue || ''));
  const gov = normalizeGovernorateName(governorate);

  const rawArabic = parseArabicStyleVehicle(raw);
  if (rawArabic?.display) {
    return rawArabic.display;
  }

  const rawLatinDigitsFirst = raw.match(/(\d{4,6})\s*\/\s*(\d{2}[A-Z])/i);
  if (rawLatinDigitsFirst) {
    return `${rawLatinDigitsFirst[1]}/${rawLatinDigitsFirst[2].toUpperCase()}`;
  }

  const rawLatinPrefixFirst = raw.match(/(\d{2}[A-Z])\s*\/\s*(\d{4,6})/i);
  if (rawLatinPrefixFirst) {
    return `${rawLatinPrefixFirst[2]}/${rawLatinPrefixFirst[1].toUpperCase()}`;
  }

  if (raw && /\//.test(raw)) return raw;
  return formatVehicleDisplay(canonicalOrDbValue, gov);
}

function preferVehicleDocumentDisplay(rawValue = '', canonicalOrDbValue = '', governorate = '') {
  const raw = cleanValue(toWesternDigitsSafe(rawValue || ''));
  const parsed = parseArabicStyleVehicle(raw);
  if (parsed?.display) return parsed.display;
  return formatVehicleAsDocument(rawValue, canonicalOrDbValue, governorate);
}

function canonicalVehicleKey(value = '') {
  const arabicParsed = parseArabicStyleVehicle(value);
  if (arabicParsed?.vehicleNumber) {
    return normalizeTextKey(
      `${arabicParsed.vehicleNumber}${arabicParsed.governorate ? `/${arabicParsed.governorate}` : ''}`
    ).replace(/\s+/g, '');
  }

  const raw = cleanValue(value).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';

  const slashDigitsFirst = raw.match(/^(\d{4,6})\/(\d{1,3}[A-Z])$/i);
  if (slashDigitsFirst) return `${slashDigitsFirst[2].toUpperCase()}${slashDigitsFirst[1]}`;

  const slashPrefixFirst = raw.match(/^(\d{1,3}[A-Z])\/(\d{4,6})$/i);
  if (slashPrefixFirst) return `${slashPrefixFirst[1].toUpperCase()}${slashPrefixFirst[2]}`;

  return raw.replace(/[^A-Z0-9]/g, '');
}

function parseCanonicalVehicleKey(value = '') {
  const canonical = canonicalVehicleKey(value);
  const arabic = canonical.match(/^([\u0621-\u064A])(\d{4,6})(?:\/([\u0600-\u06FF\s]+))?$/);
  if (arabic) {
    return {
      canonical,
      prefix: arabic[1],
      digits: arabic[2],
      governorate: normalizeGovernorateName(arabic[3] || ''),
      isArabic: true,
    };
  }

  const parts = canonical.match(/^(\d{1,3}[A-Z])(\d{4,6})$/i);
  if (!parts) {
    return { canonical, prefix: '', digits: canonical.replace(/\D/g, ''), governorate: '', isArabic: false };
  }
  return {
    canonical,
    prefix: parts[1].toUpperCase(),
    digits: parts[2],
    governorate: '',
    isArabic: false,
  };
}

function vehicleMatchScore(input = '', candidate = '') {
  const a = parseCanonicalVehicleKey(input);
  const b = parseCanonicalVehicleKey(candidate);

  if (!a.canonical || !b.canonical) return 0;
  if (a.canonical === b.canonical) return 1;
  if (a.prefix && b.prefix && a.prefix === b.prefix && a.digits && b.digits && a.digits === b.digits) return 0.99;
  if (a.digits && b.digits && a.digits === b.digits) return 0.62;
  if (a.canonical.includes(b.canonical) || b.canonical.includes(a.canonical)) return 0.45;
  return 0;
}

async function ensureTempDir() {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) {
    await fsp.mkdir(tempDir, { recursive: true });
  }
  return tempDir;
}

async function matchLoadingWarehouse(name = '') {
  const clean = sanitizeWarehouseName(normalizeWarehouseCandidate(name));
  if (!clean) return null;

  const key = normalizeTextKey(clean);

  let found = await LoadingWarehouse.findOne({ nameKey: key });
  if (found) return found;

  found = await LoadingWarehouse.findOne({
    name: { $regex: escapeRegex(clean), $options: 'i' },
  });
  if (found) return found;

  const candidates = await LoadingWarehouse.find({
    name: { $regex: escapeRegex(clean.slice(0, Math.max(2, Math.min(clean.length, 12)))), $options: 'i' },
  })
    .select('name governorate nameKey')
    .limit(25);

  return (
    candidates.find((item) => {
      const a = normalizeTextKey(item.name || '');
      return a.includes(key) || key.includes(a);
    }) || null
  );
}

async function matchVehicleSmart(vehicleNumber = '') {
  if (!vehicleNumber) return null;

  const key = normalizeTextKey(vehicleNumber);
  const compact = key.replace(/\s+/g, '');
  const canonical = canonicalVehicleKey(vehicleNumber);
  const arabicParsed = parseArabicStyleVehicle(vehicleNumber);

  if (arabicParsed?.vehicleNumber) {
    const arabicVehicleKey = normalizeTextKey(arabicParsed.vehicleNumber);
    const arabicGovernorateKey = normalizeTextKey(arabicParsed.governorate || '');

    let found = await Vehicle.findOne({
      vehicleNumberKey: arabicVehicleKey,
      governorateKey: arabicGovernorateKey,
    }).populate('driver owner vehicleType');
    if (found) return found;

    found = await Vehicle.findOne({
      vehicleNumberKey: arabicVehicleKey,
    }).populate('driver owner vehicleType');
    if (found) return found;

    const regexDigits = arabicParsed.digits ? new RegExp(`${escapeRegex(arabicParsed.digits)}$`, 'i') : null;
    const governorateKey = normalizeTextKey(arabicParsed.governorate || '');
    if (regexDigits && governorateKey) {
      const localizedCandidates = await Vehicle.find({
        governorateKey,
        vehicleNumber: { $regex: regexDigits },
      })
        .select('vehicleNumber governorate driver owner vehicleType capacityLiters vehicleNumberKey governorateKey')
        .limit(10)
        .populate('driver owner vehicleType');

      if (localizedCandidates.length === 1) {
        return localizedCandidates[0];
      }

      let localizedBest = null;
      let localizedBestScore = 0;
      for (const item of localizedCandidates) {
        const candidateKey = canonicalVehicleKey(
          `${item.vehicleNumber || ''}${item.governorate ? `/${item.governorate}` : ''}`
        );
        let score = vehicleMatchScore(vehicleNumber, candidateKey);
        const parsedCandidate = parseCanonicalVehicleKey(candidateKey);
        if (parsedCandidate.isArabic && parsedCandidate.digits === arabicParsed.digits) {
          score += 0.28;
        }
        if (parsedCandidate.governorate && parsedCandidate.governorate === arabicParsed.governorate) {
          score += 0.2;
        }
        if (score > localizedBestScore) {
          localizedBest = item;
          localizedBestScore = score;
        }
      }

      if (localizedBest && localizedBestScore >= 0.75) {
        return localizedBest;
      }
    }
  }

  let found = await Vehicle.findOne({ vehicleNumberKey: key }).populate('driver owner vehicleType');
  if (found) return found;

  found = await Vehicle.findOne({ vehicleNumberKey: compact }).populate('driver owner vehicleType');
  if (found) return found;

  found = await Vehicle.findOne({
    vehicleNumber: { $regex: `^${escapeRegex(vehicleNumber)}$`, $options: 'i' },
  }).populate('driver owner vehicleType');
  if (found) return found;

  const tail = canonical.slice(-4);
  const candidates = await Vehicle.find(
    tail ? { vehicleNumber: { $regex: escapeRegex(tail), $options: 'i' } } : {}
  )
    .select('vehicleNumber governorate driver owner vehicleType capacityLiters vehicleNumberKey')
    .limit(20)
    .populate('driver owner vehicleType');

  let best = null;
  let bestScore = 0;

  for (const item of candidates) {
    const score = Math.max(
      vehicleMatchScore(vehicleNumber, item.vehicleNumber || ''),
      vehicleMatchScore(vehicleNumber, item.vehicleNumberKey || ''),
      vehicleMatchScore(
        vehicleNumber,
        `${item.vehicleNumber || ''}${item.governorate ? `/${item.governorate}` : ''}`
      )
    );
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= 0.95 ? best : null;
}

async function matchDriver(name = '') {
  const clean = sanitizeDriverName(name);
  if (!clean) return null;

  let found = await Driver.findOne({
    name: { $regex: `^${escapeRegex(clean)}$`, $options: 'i' },
  });
  if (found) return found;

  const key = normalizeTextKey(clean);
  found = await Driver.findOne({ nameKey: key });
  if (found) return found;

  const tokens = clean.split(/\s+/).filter(Boolean).slice(0, 3);
  const regexFilters = tokens.map((token) => ({ name: { $regex: escapeRegex(token), $options: 'i' } }));
  const candidates = await Driver.find(regexFilters.length ? { $or: regexFilters } : {})
    .select('name nameKey')
    .limit(40);

  let best = null;
  let bestScore = 0;

  for (const item of candidates) {
    const score = driverMatchScore(clean, item.name || item.nameKey || '');
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= 0.9 ? best : null;
}

async function resolveUnloadingPricing({ loadingWarehouseId, suppliedQuantityLiters, registrationMode = 'unloading' }) {
  const emptyResult = {
    pricing: null,
    pricingType: '',
    priceValue: 0,
    tripAmount: 0,
    advanceAmount: 0,
    payableAmount: 0,
    receiptStatus: 'لم يتم العثور على تسعيرة مطابقة',
  };

  if (!loadingWarehouseId) {
    return emptyResult;
  }

  const pricings = await TripPricing.find({
    operationType: registrationMode === 'loading' ? 'loading' : 'unloading',
    loadingWarehouse: loadingWarehouseId,
  }).sort({ createdAt: -1 });

  if (!pricings.length) {
    return emptyResult;
  }

  const qty = Number(suppliedQuantityLiters || 0);

  let selected = null;

  selected = pricings.find((p) => p.pricingType === 'liter');
  if (selected) {
    const priceValue = Number(selected.price || 0);
    const tripAmount = qty * priceValue;
    const advanceAmount = Number(selected.advance || 0);
    const payableAmount = advanceAmount > 0 ? advanceAmount : tripAmount;

    return {
      pricing: selected,
      pricingType: 'liter',
      priceValue,
      tripAmount,
      advanceAmount,
      payableAmount,
      receiptStatus: advanceAmount > 0
        ? 'تم اعتماد السلفة لتسعيرة باللتر'
        : 'تم احتساب مبلغ النقلة حسب اللتر',
    };
  }

  selected = pricings.find((p) => {
    if (p.pricingType !== 'capacityRange') return false;
    const from = Number(p.capacityFrom ?? 0);
    const to = Number(p.capacityTo ?? 0);
    return qty >= from && qty <= to;
  });

  if (selected) {
    const priceValue = Number(selected.price || 0);
    const tripAmount = priceValue;
    const advanceAmount = 0;
    const payableAmount = tripAmount;

    return {
      pricing: selected,
      pricingType: 'capacityRange',
      priceValue,
      tripAmount,
      advanceAmount,
      payableAmount,
      receiptStatus: 'تم احتساب مبلغ النقلة حسب الحمولة',
    };
  }

  selected = pricings.find((p) => p.pricingType === 'fixed');
  if (selected) {
    const priceValue = Number(selected.price || 0);
    const tripAmount = priceValue;
    const advanceAmount = Number(selected.advance || 0);
    const payableAmount = advanceAmount > 0 ? advanceAmount : tripAmount;

    return {
      pricing: selected,
      pricingType: 'fixed',
      priceValue,
      tripAmount,
      advanceAmount,
      payableAmount,
      receiptStatus: advanceAmount > 0
        ? 'تم اعتماد السلفة لتسعيرة ثابتة'
        : 'تم احتساب مبلغ النقلة بسعر ثابت',
    };
  }

  return emptyResult;
}

function buildWarnings(extracted, registrationMode = 'unloading') {
  const warnings = [];

  if (!/^[A-Z]\d{7,8}$/.test(extracted.documentNumber || '')) {
    warnings.push('رقم المستند غير مؤكد');
  }

  if (!extracted.documentType) warnings.push('نوع المستند غير واضح');
  if (!extracted.driverName) warnings.push('اسم السائق غير واضح');
  if (!extracted.vehicleNumber) warnings.push('رقم المركبة غير واضح');
  if (!extracted.loadingWarehouseName) warnings.push('الجهة المجهزة غير واضحة');
  if (!extracted.issueDate) warnings.push('تاريخ الإصدار غير واضح');

  const receiverWarning = getReceiverEntityWarning(extracted.receiverEntity);
  if (registrationMode !== 'loading' && receiverWarning && !isReceiverEntityAccepted(extracted.receiverEntity)) {
    warnings.push(receiverWarning);
  }

  return warnings;
}

function getVisionFieldConfidence(visionReview = {}, field = '') {
  const confidence = Number(visionReview?.fields?.fieldConfidence?.[field]);
  if (Number.isFinite(confidence)) {
    return Math.max(0, Math.min(1, confidence));
  }
  return 0;
}

function shouldRunOcrFallback(visionReview = {}, registrationMode = 'unloading') {
  if (!visionReview?.success || !visionReview?.fields) return true;

  const fields = visionReview.fields || {};
  const vehicle = canonicalVehicleValue(fields.vehicleNumber || '');
  const driver = sanitizeDriverName(fields.driverName || '');
  const warehouse = sanitizeWarehouseName(normalizeWarehouseCandidate(fields.loadingWarehouseName || ''));
  const documentNumber = normalizeDocumentNumber(fields.documentNumber || '');
  const issueDate = normalizeDateValue(fields.issueDate || '');
  const documentType = canonicalDocumentType(fields.documentType || '');
  const receiverEntity = cleanValue(fields.receiverEntity || '');
  const receiverOk = registrationMode === 'loading' ? true : isReceiverEntityAccepted(receiverEntity);

  const vehicleOk = !!vehicle && getVisionFieldConfidence(visionReview, 'vehicleNumber') >= 0.72;
  const driverOk = !!driver && driver.split(/\s+/).filter(Boolean).length >= 3
    && getVisionFieldConfidence(visionReview, 'driverName') >= 0.55;
  const warehouseOk = !!warehouse && hasWarehouseKeyword(warehouse)
    && getVisionFieldConfidence(visionReview, 'loadingWarehouseName') >= 0.5;
  const documentOk = !!documentNumber;
  const dateOk = !!issueDate;
  const typeOk = !!documentType;

  const criticalCount = [vehicleOk, warehouseOk].filter(Boolean).length;
  const supportCount = [documentOk, dateOk, typeOk].filter(Boolean).length;
  const score = Number(visionReview?.score || 0);

  if (!typeOk) return true;
  if (!receiverOk) return true;
  if (!documentOk) return true;
  if (!dateOk) return true;
  if (!warehouseOk) return true;
  if (!vehicleOk) return true;
  if (documentOk && dateOk && warehouseOk && vehicleOk && score >= 8) return false;
  if (criticalCount >= 2 && supportCount >= 3 && (driverOk || vehicleOk) && score >= 10) return false;

  return true;
}

function shouldVerifyDocumentTypeWithOcr(visionReview = {}) {
  if (!visionReview?.success || !visionReview?.fields) return true;

  const visionDocumentType = canonicalDocumentType(visionReview.fields.documentType || '');
  if (!visionDocumentType) return true;

  // Vision can confuse the small icon with other stamped shapes.
  // Re-check with OCR when vision reports 68ا, which is the most frequent false positive.
  if (visionDocumentType === '68ا') return true;

  return false;
}

exports.extractUnloadingRecordFromImage = async (req, res) => {
  // strict fail-closed extraction path
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم إرسال صورة' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'الملف المرسل ليس صورة' });
    }

    const registrationMode = getRegistrationMode(req);
    const requestedOcrMode = typeof req.body?.ocrMode === 'string' ? req.body.ocrMode.trim() : '';
    const forceOcr = ['1', 'true', 'yes'].includes(String(req.body?.forceOcr || '').toLowerCase());
    const ocrMode = requestedOcrMode || 'default';
    const useVisionReview = process.env.UNLOADING_ENABLE_VISION_REVIEW !== '0';
    const ocrOptionsMap = {
      default: {},
      retry_fast: { maxWidth: 2200, jpegQuality: 90, grayscale: true, sharpen: true },
      retry_deep: { maxWidth: 2400, jpegQuality: 92, grayscale: true, normalize: true, sharpen: true },
    };
    const ocrOptions = ocrOptionsMap[ocrMode] || ocrOptionsMap.default;

    let visionReview = {
      available: false,
      success: false,
      message: forceOcr ? 'Vision skipped بسبب forceOcr' : '',
      fields: {},
      attempts: [],
      topCandidates: {},
      score: 0,
      model: '',
      source: '',
    };

    if (useVisionReview && !forceOcr) {
      const { review } = await runPrioritizedVisionReview(buildVisionReviewTasks(req), { registrationMode });
      visionReview = review || visionReview;
    }

    let extracted = createEmptyExtractionResult();
    const visionPrimary = Boolean(useVisionReview && !forceOcr && visionReview?.success);
    const shouldUseOcr = forceOcr || !visionPrimary || shouldRunOcrFallback(visionReview, registrationMode) || shouldVerifyDocumentTypeWithOcr(visionReview);

    if (shouldUseOcr) {
      const tempDir = await ensureTempDir();
      const tmpPath = path.join(tempDir, `unloading-${Date.now()}.png`);
      await fsp.writeFile(tmpPath, req.file.buffer);

      try {
        extracted = await runEasyOcr(
          tmpPath,
          registrationMode === 'loading' ? 'loading-90-template' : 'unloading-template',
          ocrOptions
        );
      } catch (error) {
        console.warn('[extract] runEasyOcr failed:', error);
        extracted = createEmptyExtractionResult();
        extracted.meta = {
          ...(extracted.meta || {}),
          ocrError: error?.message || 'runEasyOcr failed',
        };
      } finally {
        await fsp.unlink(tmpPath).catch(() => {});
      }
    } else {
      extracted = createEmptyExtractionResult();
      extracted.meta = {
        ...(extracted.meta || {}),
        ocrSkipped: true,
      };
    }

    const visionFields = visionReview?.fields || {};
    const visionRawText = cleanValue(visionReview?.raw || '');
    const ocrRawText = cleanValue(extracted.rawText || '');
    const combinedRawText = ocrRawText || visionRawText;

    const repairedReceiverOcr = repairBrokenWords(extracted.receiverEntity || '');
    const repairedReceiverVision = repairBrokenWords(visionFields.receiverEntity || '');
    const receiverEntityOcr = repairedReceiverOcr;
    const receiverEntityVision = repairedReceiverVision;
    const receiverEntityTextFallback = registrationMode === 'loading'
      ? extractLoadingReceiverPhraseFromRawText(combinedRawText || '')
      : '';
    const preferredReceiverRaw = registrationMode === 'loading'
      ? (repairedReceiverVision || receiverEntityTextFallback || repairedReceiverOcr)
      : (repairedReceiverVision || repairedReceiverOcr);
    const receiverWarehouseCandidate = registrationMode === 'loading'
      ? await matchLoadingReceiverEntity(preferredReceiverRaw)
      : null;
    const canonicalReceiver = registrationMode === 'loading'
      ? (receiverWarehouseCandidate?.name || preferredReceiverRaw)
      : (isReceiverEntityAccepted(preferredReceiverRaw)
        ? (canonicalReceiverEntity(preferredReceiverRaw, extracted.rawText || '') || CANONICAL_RECEIVER_ENTITY)
        : preferredReceiverRaw);

    const vehicleNumberOcr = preferVehicleDocumentDisplay(
      extracted.vehicleNumberRaw || '',
      extracted.vehicleNumber || '',
      extracted.vehicleGovernorate || ''
    );
    const vehicleNumberVision = cleanValue(visionFields.vehicleNumber || '');
    const mergedVehicleNumber = preferVehicleValue(vehicleNumberVision, vehicleNumberOcr, extracted.vehicleNumberRaw || '');

    const driverNameOcr = extracted.driverName || '';
    const driverNameVision = cleanValue(visionFields.driverName || '');
    const mergedDriverName = preferDriverValue(driverNameVision, driverNameOcr);

    const warehouseOcr = normalizeWarehouseCandidate(extracted.loadingWarehouseName || '');
    const warehouseVision = cleanValue(visionFields.loadingWarehouseName || '');
    const mergedWarehouse = preferWarehouseValueStrict(warehouseVision, warehouseOcr);

    const issueDateValue = normalizeDateValue(visionFields.issueDate || extracted.issueDate || '');
    const documentNumberValue = normalizeDocumentNumber(visionFields.documentNumber || extracted.documentNumber || '');
    const visionDocumentType = canonicalDocumentType(visionFields.documentType || '');
    const ocrDocumentType = canonicalDocumentType(extracted.documentType || '');
    const documentTypeValue = visionDocumentType || ocrDocumentType || extracted.documentType || '';
    const productTypeValue = cleanValue(
      visionFields.productType || extracted.productType || ''
    );
    const quantityFromVision = parseQuantityValue(visionFields.suppliedQuantityLiters || '');

    const ocrMatches = extracted.ocrMatches || {};
    const visionFieldConfidence = visionFields.fieldConfidence || {};
    const visionTopCandidates = visionReview?.topCandidates || {};

    const extractedData = {
      documentNumber: documentNumberValue || extracted.documentNumber || '',
      documentType: documentTypeValue || extracted.documentType || '',
      productType: productTypeValue || extracted.productType || '',
      loadingWarehouseName: mergedWarehouse,
      loadingWarehouseOcr: warehouseOcr,
      receiverEntity: registrationMode === 'loading'
        ? canonicalReceiver
        : isReceiverEntityAccepted(preferredReceiverRaw)
          ? CANONICAL_RECEIVER_ENTITY
          : canonicalReceiver,
      receiverEntityOcr,
      receiverEntityVision,
      vehicleNumber: mergedVehicleNumber,
      vehicleNumberOcr: vehicleNumberOcr,
      vehicleNumberRaw: extracted.vehicleNumberRaw || '',
      vehicleGovernorate: extracted.vehicleGovernorate || '',
      driverName: mergedDriverName,
      driverNameOcr,
      suppliedQuantityLiters: Number(extracted.suppliedQuantityLiters || quantityFromVision || 0),
      issueDate: issueDateValue || extracted.issueDate || '',
      rawText: combinedRawText || '',
      meta: extracted.meta || {},
    };

    const strictSignalMatches = {
      ...ocrMatches,
      vehicle: mergeMatchSignals(
        ocrMatches.vehicle || {},
        extractedData.vehicleNumber || '',
        visionFieldConfidence.vehicleNumber,
        visionTopCandidates.vehicleNumber || []
      ),
      driver: mergeMatchSignals(
        ocrMatches.driver || {},
        extractedData.driverName || '',
        visionFieldConfidence.driverName,
        visionTopCandidates.driverName || []
      ),
      loadingWarehouse: mergeMatchSignals(
        ocrMatches.loadingWarehouse || {},
        extractedData.loadingWarehouseName || '',
        visionFieldConfidence.loadingWarehouseName,
        visionTopCandidates.loadingWarehouseName || []
      ),
    };

    let [
      loadingWarehouseCandidate,
      vehicleCandidateByNumber,
      vehicleCandidateByRaw,
      driverCandidateByName,
      warehouseWhitelistRaw,
    ] = await Promise.all([
      matchLoadingWarehouse(extractedData.loadingWarehouseName),
      matchVehicleSmart(extractedData.vehicleNumber),
      extractedData.vehicleNumberRaw ? matchVehicleSmart(extractedData.vehicleNumberRaw) : Promise.resolve(null),
      matchDriver(extractedData.driverName),
      LoadingWarehouse.find({}).select('name governorate').lean(),
    ]);
    const warehouseWhitelist = filterWarehouseWhitelistByMode(warehouseWhitelistRaw, registrationMode);

    const vehicleCandidate = vehicleCandidateByNumber || vehicleCandidateByRaw || null;
    const linkedDriverCandidate =
      vehicleCandidate?.driver && typeof vehicleCandidate.driver === 'object'
        ? vehicleCandidate.driver
        : null;
    const driverCandidate = linkedDriverCandidate || driverCandidateByName || null;

    if (registrationMode === 'loading' && loadingWarehouseCandidate && !isLoadingWarehouseAllowed(loadingWarehouseCandidate.name || '')) {
      loadingWarehouseCandidate = null;
    }

    if (loadingWarehouseCandidate?.name) {
      extractedData.loadingWarehouseName = loadingWarehouseCandidate.name;
    }
    if (vehicleCandidate?.vehicleNumber) {
      extractedData.vehicleNumber = preferVehicleDocumentDisplay(
        extractedData.vehicleNumberRaw || extracted.vehicleNumberRaw || '',
        vehicleCandidate.vehicleNumber,
        vehicleCandidate.governorate || extractedData.vehicleGovernorate || ''
      );
      extractedData.vehicleGovernorate = vehicleCandidate.governorate || extractedData.vehicleGovernorate || '';
    }
    if (driverCandidate?.name) {
      extractedData.driverName = driverCandidate.name;
    }

    const visionDisagreements = [];
    if (visionReview?.success && visionReview?.fields) {
      const visionVehicle = canonicalVehicleValue(visionReview.fields.vehicleNumber || '');
      const ocrVehicle = canonicalVehicleValue(vehicleNumberOcr || extracted.vehicleNumberRaw || '');
      if (visionVehicle && ocrVehicle && visionVehicle !== ocrVehicle) {
        visionDisagreements.push({ field: 'vehicleNumber', reasonCode: 'vision_disagreement' });
      }

      const visionDriver = normalizeDriverKey(visionReview.fields.driverName || '');
      const ocrDriver = normalizeDriverKey(driverNameOcr || '');
      if (visionDriver && ocrDriver && visionDriver !== ocrDriver) {
        visionDisagreements.push({ field: 'driverName', reasonCode: 'vision_disagreement' });
      }

      const visionWarehouse = normalizeTextKey(normalizeWarehouseCandidate(visionReview.fields.loadingWarehouseName || ''));
      const ocrWarehouse = normalizeTextKey(normalizeWarehouseCandidate(warehouseOcr || ''));
      if (visionWarehouse && ocrWarehouse && visionWarehouse !== ocrWarehouse) {
        visionDisagreements.push({ field: 'loadingWarehouseName', reasonCode: 'vision_disagreement' });
      }
    }

    const loadingReceiverCandidate = registrationMode === 'loading'
      ? await matchLoadingReceiverEntity(extractedData.receiverEntity || preferredReceiverRaw)
      : null;
    const receiverDestinationCandidate = loadingReceiverCandidate || receiverWarehouseCandidate;
    if (registrationMode === 'loading' && receiverDestinationCandidate?.name) {
      extractedData.receiverEntity = receiverDestinationCandidate.name;
    }

    const loadingWarehouseId = loadingWarehouseCandidate?._id || null;
    const vehicleId = vehicleCandidate?._id || null;
    const driverId = driverCandidate?._id || null;

    const [loadingWarehouse, vehicle, driver] = await Promise.all([
      loadingWarehouseId ? LoadingWarehouse.findById(loadingWarehouseId).select('name governorate') : Promise.resolve(null),
      vehicleId ? Vehicle.findById(vehicleId).select('vehicleNumber governorate driver owner vehicleType capacityLiters').populate('driver owner vehicleType') : Promise.resolve(null),
      driverId ? Driver.findById(driverId).select('name') : Promise.resolve(null),
    ]);

    if (loadingWarehouse?.name) {
      extractedData.loadingWarehouseName = loadingWarehouse.name;
    }
    if (vehicle?.vehicleNumber) {
      extractedData.vehicleNumber = preferVehicleDocumentDisplay(
        extractedData.vehicleNumberRaw || extracted.vehicleNumberRaw || '',
        vehicle.vehicleNumber,
        vehicle.governorate || extractedData.vehicleGovernorate || ''
      );
      extractedData.vehicleGovernorate = vehicle.governorate || extractedData.vehicleGovernorate || '';
    }
    if (driver?.name) {
      extractedData.driverName = driver.name;
    }

    const vehicleDriverLinked =
      Boolean(vehicle?.driver)
      && Boolean(driver?._id)
      && toIdString(vehicle.driver) === toIdString(driver._id);
    const vehicleDriverMatches = vehicle?.driver
      ? vehicleDriverLinked
      : Boolean(vehicleId && driverId)
        ? false
        : true;

    const strictEvaluation = buildUnloadingStrictChecks({
      values: {
        vehicleNumber: extractedData.vehicleNumber,
        vehicleNumberRaw: extractedData.vehicleNumberRaw,
        driverName: extractedData.driverName,
        loadingWarehouseName: extractedData.loadingWarehouseName,
      },
      ocrMatches: strictSignalMatches,
      entities: {
        loadingWarehouse: loadingWarehouse || loadingWarehouseCandidate,
        vehicle: vehicle || vehicleCandidate,
        driver: driver || driverCandidate,
      },
      warehouseWhitelist,
    });

    if (vehicleId && driverId && !vehicleDriverMatches) {
      const unlinkedError = {
        field: 'driverName',
        reasonCode: 'vehicle_driver_unlinked',
        message: 'السائق غير مرتبط بالمركبة',
      };
      strictEvaluation.blockingErrors = [...strictEvaluation.blockingErrors, unlinkedError];
      strictEvaluation.canSave = false;
      strictEvaluation.strictChecks = {
        ...strictEvaluation.strictChecks,
        driverName: {
          ...(strictEvaluation.strictChecks.driverName || {}),
          reasonCodes: [
            ...(strictEvaluation.strictChecks.driverName?.reasonCodes || []),
            'vehicle_driver_unlinked',
          ],
        },
      };
    }

    const validations = {
      documentNumberValid: /^[A-Z]\d{7,8}$/.test(extractedData.documentNumber || ''),
      vehicleNumberValid: Boolean(canonicalVehicleValue(extractedData.vehicleNumber || '')),
      receiverEntityValid: registrationMode === 'loading'
        ? Boolean(receiverDestinationCandidate?.name)
        : isReceiverEntityAccepted(extractedData.receiverEntity || ''),
      loadingWarehouseFound: !!loadingWarehouseId,
      vehicleFound: !!vehicleId,
      driverFound: !!driverId,
      pricingFound: false,
      vehicleDriverMatches,
      driverVehicleLinked: vehicleDriverMatches,
    };

    const existing = validations.documentNumberValid
      ? await UnloadingRecord.findOne({ documentNumberKey: extractedData.documentNumber }).select('_id')
      : null;

    if (loadingWarehouseId && extractedData.suppliedQuantityLiters) {
      const pricingPreview = await resolveUnloadingPricing({
        loadingWarehouseId,
        suppliedQuantityLiters: extractedData.suppliedQuantityLiters,
        registrationMode,
      });
      validations.pricingFound = !!pricingPreview.pricing;
    }

    const receiverEntityWarning = registrationMode === 'loading'
      ? (receiverDestinationCandidate?.name
        ? ''
        : 'الجهة المرسل إليها يجب أن تطابق قاعدة بيانات جهات التحميل')
      : getReceiverEntityWarning(extractedData.receiverEntity);

    const warnings = buildWarnings(extractedData, registrationMode);
    if (extracted?.meta?.ocrError) {
      warnings.push(`OCR fallback failed: ${extracted.meta.ocrError}`);
    }
    for (const blocker of strictEvaluation.blockingErrors) {
      const fieldLabel = blocker.field === 'vehicleNumber'
        ? 'رقم المركبة'
        : blocker.field === 'driverName'
          ? 'اسم السائق'
          : 'مستودع التحميل';
      warnings.push(`مراجعة إلزامية: ${fieldLabel} (${blocker.reasonCode})`);
    }

    for (const item of visionDisagreements) {
      const fieldLabel = item.field === 'vehicleNumber'
        ? 'رقم المركبة'
        : item.field === 'driverName'
          ? 'اسم السائق'
          : 'مستودع التحميل';
      warnings.push(`تنبيه: اختلاف بين Vision و OCR في ${fieldLabel}`);
    }

    if (vehicle?.capacityLiters && extractedData.suppliedQuantityLiters) {
      const diff = Number(extractedData.suppliedQuantityLiters) - Number(vehicle.capacityLiters);
      if (diff > 1000) {
        warnings.push(`الكمية المجهزة تزيد عن حمولة المركبة بأكثر من 1000 لتر (${diff} لتر)`);
      }
    }

    const message = strictEvaluation.canSave
      ? `تمت قراءة المستند بنجاح. الجهة المرسل إليها: ${extractedData.receiverEntity || 'غير محددة'}`
      : 'تمت القراءة لكن توجد حقول حرجة تحتاج مراجعة إلزامية قبل الحفظ';

    const driverMatchSource = linkedDriverCandidate?.name
      ? 'vehicle_linked_driver'
      : driverCandidateByName?.name
        ? 'database_fuzzy'
        : normalizeDriverKey(extractedData.driverName || '')
          && normalizeDriverKey(driverNameVision || '')
          && normalizeDriverKey(extractedData.driverName || '') === normalizeDriverKey(driverNameVision || '')
          ? 'vision_first'
          : 'ocr';
    const vehicleMatchSource = vehicleCandidate?.vehicleNumber
      ? 'database'
      : canonicalVehicleValue(extractedData.vehicleNumber || '')
        && canonicalVehicleValue(vehicleNumberVision || '')
        && canonicalVehicleValue(extractedData.vehicleNumber || '') === canonicalVehicleValue(vehicleNumberVision || '')
        ? 'vision_first'
        : 'ocr';
    const warehouseMatchSource = loadingWarehouseCandidate?.name
      ? 'database'
      : normalizeTextKey(normalizeWarehouseCandidate(extractedData.loadingWarehouseName || ''))
        && normalizeTextKey(normalizeWarehouseCandidate(warehouseVision || ''))
        && normalizeTextKey(normalizeWarehouseCandidate(extractedData.loadingWarehouseName || ''))
          === normalizeTextKey(normalizeWarehouseCandidate(warehouseVision || ''))
        ? 'vision_first'
        : 'ocr';
    const extractionMode = visionReview?.success
      ? (shouldUseOcr ? 'vision_first_with_ocr_fallback' : 'vision_only')
      : 'ocr_only';

    return res.json({
      success: true,
      message,
      data: {
        ...extractedData,
        registrationMode,
        loadingWarehouseId: loadingWarehouseId || null,
        vehicleId: vehicleId || null,
        driverId: driverId || null,
        driverName: extractedData.driverName || '',
        driverNameOcr,
        driverMatchSource,
        loadingWarehouseOcr: extractedData.loadingWarehouseOcr || '',
        vehicleMatchSource,
        vehicleNumberOcr: extractedData.vehicleNumberOcr || '',
        warehouseMatchSource,
        extractionSource: {
          mode: extractionMode,
          ocrUsed: shouldUseOcr,
          visionUsed: Boolean(visionReview?.success),
          visionBestAttempt: visionReview?.bestAttempt || 0,
          visionAttempts: Array.isArray(visionReview?.attempts) ? visionReview.attempts : [],
          ocrMode: shouldUseOcr ? ocrMode : 'skipped',
          ocrAttempts: Array.isArray(extracted?.meta?.ensemble?.attempts) ? extracted.meta.ensemble.attempts : [],
          ocrBestAttempt: extracted?.meta?.ensemble?.bestAttemptIndex || 0,
          ocrDurationMs: extracted?.meta?.durationMs || 0,
          forceOcr,
        },
        receiverEntityOcr,
        receiverEntityVision,
        receiverEntityWarning,
        warnings,
        strictChecks: strictEvaluation.strictChecks,
        blockingErrors: strictEvaluation.blockingErrors,
        canSave: strictEvaluation.canSave,
        visionReview: {
          available: Boolean(visionReview?.available),
          success: Boolean(visionReview?.success),
          fields: visionReview?.fields || {},
          topCandidates: visionReview?.topCandidates || {},
          bestAttempt: visionReview?.bestAttempt || 0,
          attempts: Array.isArray(visionReview?.attempts) ? visionReview.attempts : [],
          score: Number(visionReview?.score || 0),
          model: visionReview?.model || '',
          message: visionReview?.message || '',
        },
        suggestions: {
          loadingWarehouse: loadingWarehouseCandidate
            ? { id: loadingWarehouseCandidate._id, name: loadingWarehouseCandidate.name }
            : null,
          vehicle: vehicleCandidate
            ? {
              id: vehicleCandidate._id,
              vehicleNumber: formatVehicleDisplay(vehicleCandidate.vehicleNumber, vehicleCandidate.governorate),
            }
            : null,
          driver: driverCandidate ? { id: driverCandidate._id, name: driverCandidate.name } : null,
        },
        validations: {
          ...validations,
          documentNumberUnique: !existing,
          strictChecksPassed: strictEvaluation.canSave,
        },
      },
    });
  } catch (err) {
    console.error('extractUnloadingRecordFromImage:', err);
    return res.status(500).json({
      message: 'خطأ في معالجة المستند',
      error: err.message,
    });
  }
};

exports.saveUnloadingRecord = async (req, res) => {
  try {
    const registrationMode = getRegistrationMode(req);
    const {
      documentNumber = '',
      documentType = '',
      loadingWarehouseId = '',
      loadingWarehouseName = '',
      receiverEntity = '',
      productType = '',
      vehicleId = '',
      vehicleNumber = '',
      driverId = '',
      driverName = '',
      suppliedQuantityLiters = 0,
      issueDate = '',
      rawText = '',
      warnings = [],
      strictChecks = {},
    } = req.body || {};

    const providedBlockingErrors = blockingErrorsFromStrictChecks(strictChecks);
    if (providedBlockingErrors.length) {
      return res.status(400).json({
        message: 'لا يمكن الحفظ قبل مراجعة الحقول الحرجة',
        blockingErrors: providedBlockingErrors,
        strictChecks,
      });
    }

    const docNum = normalizeDocumentNumber(documentNumber);
    if (!/^[A-Z]\d{7,8}$/.test(docNum)) {
      return res.status(400).json({ message: 'رقم المستند يجب أن يكون حرفًا + 7 أو 8 أرقام' });
    }

    if (await UnloadingRecord.findOne({ documentNumberKey: docNum })) {
      return res.status(400).json({ message: 'رقم المستند مسجل مسبقًا' });
    }

    const warehouse = await LoadingWarehouse.findById(loadingWarehouseId);
    if (!warehouse) {
      return res.status(400).json({ message: 'الجهة المجهزة غير معروفة' });
    }

    if (registrationMode === 'loading' && !isLoadingWarehouseAllowed(warehouse.name || '')) {
      return res.status(400).json({
        message: 'مستودع التحميل يجب أن يكون شركة الشبكة الذهبية أو مصفى النفط الذهبي',
      });
    }

    const receiverWarehouseCandidate = registrationMode === 'loading'
      ? await matchLoadingReceiverEntity(receiverEntity)
      : null;

    if (registrationMode === 'loading' && !receiverWarehouseCandidate) {
      return res.status(400).json({ message: 'الجهة المرسل إليها يجب أن تطابق قاعدة بيانات جهات التحميل' });
    }

    if (registrationMode !== 'loading' && !isReceiverEntityAccepted(receiverEntity)) {
      return res.status(400).json({ message: 'المستند غير موجه إلى مصفاة النفط الذهبي' });
    }

    const vehicle = await Vehicle.findById(vehicleId).populate('driver owner vehicleType');
    if (!vehicle) {
      return res.status(400).json({ message: 'المركبة غير موجودة' });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(400).json({ message: 'السائق غير موجود' });
    }

    const vehicleDriverLinked =
      Boolean(vehicle.driver) && toIdString(vehicle.driver) === toIdString(driver._id);
    if (!vehicleDriverLinked) {
      return res.status(400).json({
        message: 'السائق غير مرتبط بالمركبة',
        blockingErrors: [
          {
            field: 'driverName',
            reasonCode: 'vehicle_driver_unlinked',
            message: 'السائق غير مرتبط بالمركبة',
          },
        ],
      });
    }

    const warehouseWhitelist = filterWarehouseWhitelistByMode(
      await LoadingWarehouse.find({}).select('name governorate').lean(),
      registrationMode
    );
    const strictEvaluation = buildUnloadingStrictChecks({
      values: {
        vehicleNumber: vehicleNumber || formatVehicleDisplay(vehicle.vehicleNumber, vehicle.governorate),
        vehicleNumberRaw: vehicleNumber || '',
        driverName: driverName || driver.name || '',
        loadingWarehouseName: loadingWarehouseName || warehouse.name || '',
      },
      entities: {
        loadingWarehouse: warehouse,
        vehicle,
        driver,
      },
      warehouseWhitelist,
      options: { forSave: true },
    });

    if (registrationMode === 'loading' && receiverDestinationCandidate?.name) {
      strictEvaluation.strictChecks = {
        ...strictEvaluation.strictChecks,
        receiverEntity: {
          field: 'receiverEntity',
          status: 'confirmed',
          value: receiverDestinationCandidate.name,
          normalizedValue: receiverDestinationCandidate.name,
          reasonCodes: [],
          ocrConfidence: 1,
          topCandidates: [],
          matchedId: receiverDestinationCandidate._id || null,
        },
      };
    }

    if (strictEvaluation.blockingErrors.length) {
      return res.status(400).json({
        message: 'تعذر الحفظ: فشل التحقق الصارم للحقول الحرجة',
        blockingErrors: strictEvaluation.blockingErrors,
        strictChecks: strictEvaluation.strictChecks,
      });
    }

    const qty = Number(suppliedQuantityLiters || 0);
    if (!qty) {
      return res.status(400).json({ message: 'كمية مجهزة غير صالحة' });
    }

    const isoDate = normalizeDateValue(issueDate);
    if (!isoDate) {
      return res.status(400).json({ message: 'تاريخ إصدار غير صالح' });
    }

    const pricingResult = await resolveUnloadingPricing({
      loadingWarehouseId,
      suppliedQuantityLiters: qty,
      registrationMode,
    });

    if (!pricingResult.pricing) {
      return res.status(400).json({ message: 'المحور لم يتم تسعيره' });
    }

    const record = await UnloadingRecord.create({
      documentNumber: docNum,
      documentNumberKey: docNum,
      documentType: canonicalDocumentType(documentType),
      productType: cleanValue(productType || ''),
      registrationMode,
      loadingWarehouse: warehouse._id,
      receiverEntity: registrationMode === 'loading'
        ? receiverWarehouseCandidate.name
        : canonicalReceiverEntity(receiverEntity),
      vehicle: vehicle._id,
      driver: driver._id,
      suppliedQuantityLiters: qty,
      issueDate: new Date(isoDate),

      tripPricing: pricingResult.pricing?._id || null,
      pricingType: pricingResult.pricingType || '',
      priceValue: pricingResult.priceValue || 0,
      tripAmount: pricingResult.tripAmount || 0,
      advanceAmount: pricingResult.advanceAmount || 0,
      payableAmount: pricingResult.payableAmount || 0,
      receiptStatus: pricingResult.receiptStatus || '',

      warnings: Array.isArray(warnings) ? warnings.map(cleanValue) : [],
      rawText: cleanValue(rawText),
      createdBy: req.user?._id || null,
    });

    await record.populate('loadingWarehouse', 'name governorate');
    await record.populate('vehicle', 'vehicleNumber governorate capacityLiters');
    await record.populate('driver', 'name');
    if (record.tripPricing) {
      await record.populate('tripPricing');
    }

    const payload = {
      id: record._id,
      documentNumber: record.documentNumber,
      documentType: record.documentType,
      productType: record.productType || '',
      loadingWarehouse: record.loadingWarehouse?.name || '',
      receiverEntity: record.receiverEntity,
      vehicleNumber: formatVehicleDisplay(record.vehicle?.vehicleNumber || '', record.vehicle?.governorate || ''),
      driverName: record.driver?.name || '',
      suppliedQuantityLiters: record.suppliedQuantityLiters,
      issueDate: record.issueDate,

      pricingType: record.pricingType,
      priceValue: record.priceValue,
      tripAmount: record.tripAmount,
      advanceAmount: record.advanceAmount,
      payableAmount: record.payableAmount,
      receiptStatus: record.receiptStatus,

      createdAt: record.createdAt,
    };

    const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      margin: 1,
      width: 220,
    });

    return res.json({
      success: true,
      message: registrationMode === 'loading'
        ? 'تم حفظ تسجيل التحميل بنجاح'
        : 'تم حفظ تسجيل التفريغ بنجاح',
      data: { record, receipt: { ...payload, qrCodeDataUrl } },
    });
  } catch (err) {
    console.error('saveUnloadingRecord:', err);
    return res.status(500).json({ message: 'فشل في حفظ التفريغ', error: err.message });
  }
};

exports.listRecentUnloadingReceipts = async (req, res) => {
  try {
    const registrationMode = getRegistrationMode(req);
    const since = new Date(Date.now() - (34 * 60 * 60 * 1000));

    const items = await UnloadingRecord.find({
      createdAt: { $gte: since },
      ...buildRegistrationModeFilter(registrationMode),
    })
      .populate('loadingWarehouse', 'name governorate')
      .populate('vehicle', 'vehicleNumber governorate capacityLiters')
      .populate('driver', 'name')
      .populate('tripPricing')
      .sort({ createdAt: -1 })
      .limit(300);

    const rows = await Promise.all(
      items.map(async (record) => {
        const payload = {
          id: record._id,
          documentNumber: record.documentNumber,
          documentType: record.documentType,
          productType: record.productType || '',
          loadingWarehouse: record.loadingWarehouse?.name || '',
          receiverEntity: record.receiverEntity || '',
          vehicleNumber: formatVehicleDisplay(record.vehicle?.vehicleNumber || '', record.vehicle?.governorate || ''),
          driverName: record.driver?.name || '',
          suppliedQuantityLiters: record.suppliedQuantityLiters || 0,
          issueDate: record.issueDate,
          pricingType: record.pricingType || '',
          priceValue: record.priceValue || 0,
          tripAmount: record.tripAmount || 0,
          advanceAmount: record.advanceAmount || 0,
          payableAmount: record.payableAmount || 0,
          receiptStatus: record.receiptStatus || '',
          createdAt: record.createdAt,
        };

        const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
          margin: 1,
          width: 220,
        });

        return {
          ...payload,
          qrCodeDataUrl,
        };
      })
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error('listRecentUnloadingReceipts:', err);
    return res.status(500).json({
      success: false,
      message: 'فشل في جلب الوصولات الحديثة',
      error: err.message,
    });
  }
};

exports.listUnloadingRecords = async (req, res) => {
  try {
    const registrationMode = getRegistrationMode(req);
    const items = await UnloadingRecord.find(buildRegistrationModeFilter(registrationMode))
      .populate('loadingWarehouse', 'name governorate')
      .populate('vehicle', 'vehicleNumber governorate capacityLiters')
      .populate('driver', 'name')
      .populate('tripPricing')
      .sort({ createdAt: -1 });

    return res.json(items);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
