const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName,
  cleanValue,
  normalizeTextKey,
  parseVehicleFieldSmart,
} = require('./unloadingFieldReader');
const {
  canonicalVehicleValue,
  normalizeWarehouseCandidate,
} = require('./unloadingStrictChecks');
const { runFastOcr } = require('./unloadingFastOcrBridge');
const { isGoldenRefinery, repairBrokenWords } = require('./arabicFuzzy');

const OCR_PROFILES = {
  default: [
    { id: 'default', profileName: 'default', maxWidth: 1800, jpegQuality: 82, grayscale: true },
  ],
  retry_fast: [
    { id: 'default', profileName: 'default', maxWidth: 1800, jpegQuality: 82, grayscale: true },
    { id: 'detail', profileName: 'detail', maxWidth: 2200, jpegQuality: 90, grayscale: true, sharpen: true },
  ],
  retry_deep: [
    { id: 'default', profileName: 'default', maxWidth: 1800, jpegQuality: 82, grayscale: true },
    { id: 'detail', profileName: 'detail', maxWidth: 2200, jpegQuality: 92, grayscale: true, sharpen: true },
    { id: 'contrast', profileName: 'contrast', maxWidth: 2000, jpegQuality: 88, grayscale: true, normalize: true, sharpen: true },
    { id: 'color', profileName: 'color', maxWidth: 2100, jpegQuality: 90, grayscale: false, normalize: true, sharpen: true },
  ],
};

function createEmptyExtractionResult() {
  return {
    success: false,
    documentType: '',
    documentNumber: '',
    productType: '',
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

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isLoadingTemplateName(templateName = '') {
  return String(templateName || '').includes('loading');
}

function countArabicTokens(value = '') {
  return sanitizeDriverName(value || '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => /^[\u0621-\u064A]{2,}$/.test(token)).length;
}

function hasArabicNameShape(value = '') {
  const cleaned = sanitizeDriverName(value || '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/).filter((token) => /^[\u0621-\u064A]{2,}$/.test(token));
  return parts.length >= 3 && parts.length <= 6;
}

function hasWarehouseKeyword(value = '') {
  return /(?:\u0645\u0633\u062a\u0648\u062f\u0639|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629)/.test(String(value || ''));
}

function parseQuantityValue(value = '') {
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
  const digits = String(value || '')
    .replace(/[\u0660-\u0669]/g, (d) => map[d] || d)
    .match(/\d{3,6}/g) || [];
  const list = digits
    .map((item) => Number(item))
    .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 60000);
  if (!list.length) return 0;
  return list.sort((a, b) => b - a)[0];
}

function pickBestDateValue(rawValues = [], fallback = '') {
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  const scored = [];

  for (const item of values) {
    const raw = cleanValue(item || '');
    const normalized = normalizeDateValue(raw);
    if (!normalized) continue;

    let score = 0;
    if (/\d{4}[-/]\d{2}[-/]\d{2}/.test(raw)) score += 5;
    if (/[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}/.test(normalized)) score += 3;
    if (!/-01$/.test(normalized)) score += 2;
    if (/2026/.test(normalized)) score += 1;
    score += Math.min(raw.length / 20, 2);

    scored.push({ raw, normalized, score });
  }

  if (!scored.length) {
    return normalizeDateValue(fallback || '');
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].normalized || normalizeDateValue(fallback || '');
}

function pickBestVehicleValue(rawValues = [], fallback = '') {
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  const scored = [];

  for (const item of values) {
    const raw = cleanValue(item || '');
    if (!raw) continue;
    const parsed = parseVehicleFieldSmart(raw);
    const canonical = parsed?.vehicleNumber || canonicalVehicleValue(raw);
    if (!canonical) continue;

    let score = 0;
    if (parsed?.governorate) score += 3;
    if (parsed?.letter) score += 2;
    if (/\/\s*(?:\d{2}[A-Z]|[A-Z]\d{2})/i.test(raw) || /\d{4,6}\s*\/\s*\d{2}[A-Z]/i.test(raw)) score += 6;
    if (/\d{4,6}\s*\/\s*[A-Z\u0621-\u064A]/i.test(raw)) score += 4;
    if (/[A-Z\u0621-\u064A]\d{4,6}/.test(raw)) score += 2;
    if (/^[\u0621-\u064A]\d{7,}$/.test(canonical)) score -= 4;
    if (/^\d{7,}$/.test(canonical)) score -= 4;
    score += Math.min(raw.length / 20, 2);
    scored.push({ raw, parsed, canonical, score });
  }

  if (!scored.length) {
    const parsed = parseVehicleFieldSmart(fallback || '');
    return parsed?.vehicleNumber || canonicalVehicleValue(fallback || '');
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].canonical || canonicalVehicleValue(fallback || '');
}

function scoreProductTypeCandidate(value = '') {
  const text = cleanValue(value || '');
  if (!text) return 0;

  let score = 0;
  if (/زيت|وقود|بنزين|اسفلت|كيروسين|نفط|ديزل/.test(text)) score += 4;
  if (/\b60\s*\/\s*70\b/.test(text)) score += 4;
  if (/\d{2}\s*\/\s*\d{2}/.test(text)) score += 2;
  if (text.length >= 4 && text.length <= 40) score += 1;
  if (/\d{3,}/.test(text)) score -= 1;
  return score;
}

function pickBestProductTypeValue(values = [], fallback = '') {
  const list = (Array.isArray(values) ? values : [values]).map((item) => cleanValue(item || '')).filter(Boolean);
  if (!list.length) return cleanValue(fallback || '');

  const buckets = new Map();
  for (const value of list) {
    const key = normalizeTextKey(value);
    const current = buckets.get(key) || {
      value,
      count: 0,
      score: 0,
    };
    current.count += 1;
    current.score += scoreProductTypeCandidate(value);
    if (value.length > current.value.length) current.value = value;
    buckets.set(key, current);
  }

  return Array.from(buckets.values())
    .sort((a, b) => (b.count - a.count) || (b.score - a.score) || (b.value.length - a.value.length))[0]?.value
    || cleanValue(fallback || '');
}

function scoreReceiverEntityCandidate(value = '', templateName = '') {
  const text = cleanValue(value || '');
  if (!text) return 0;

  const normalized = normalizeTextKey(text);
  let score = 0;

  if (isLoadingTemplateName(templateName)) {
    if (/المنفذ|الميناء|البصرة|الزبير|الشعيبة|النجف|الدورة|الناصرية|السماوة/.test(normalized)) score += 5;
    if (/الجهة|المشتري/.test(normalized)) score += 1;
    if (text.length >= 5 && text.length <= 40) score += 1;
    if (/\d/.test(text)) score -= 2;
    return score;
  }

  if (isGoldenRefinery(text) || canonicalReceiverEntity(text || '')) score += 4;
  if (/مصفى|مصفاة|معمل/.test(normalized)) score += 2;
  if (text.length >= 8) score += 1;
  return score;
}

function pickConsensusValue(attempts = [], selector, normalizer, scorer) {
  const buckets = new Map();

  for (const attempt of attempts) {
    const rawValue = selector(attempt);
    if (!rawValue) continue;
    const normalized = normalizer ? normalizer(rawValue, attempt) : cleanValue(rawValue);
    if (!normalized) continue;

    const attemptWeight = Math.max(0.25, safeNumber(attempt?.meta?.ensembleScore, 0) || 1);
    const fieldScore = Math.max(0.25, safeNumber(scorer ? scorer(normalized, attempt, rawValue) : 1, 1));
    const weight = attemptWeight * fieldScore;
    const key = normalizeTextKey(normalized);
    const current = buckets.get(key) || { value: normalized, count: 0, weight: 0, bestWeight: 0 };

    current.count += 1;
    current.weight += weight;
    current.bestWeight = Math.max(current.bestWeight, weight);
    if (normalized.length > current.value.length) current.value = normalized;
    buckets.set(key, current);
  }

  return Array.from(buckets.values())
    .sort((a, b) => (b.count - a.count) || (b.weight - a.weight) || (b.bestWeight - a.bestWeight) || (b.value.length - a.value.length))[0]?.value
    || '';
}

function normalizeFastResult(result = {}, templateName = '') {
  const rawText = cleanValue(result.rawText || '');
  const debug = result.debug || {};
  const structuredDebug = debug.structured || {};
  const rawDebug = debug.raw || {};
  const vehicleRawCandidates = [
    result.vehicleNumberRaw || '',
    result.vehicleNumber || '',
    ...(Array.isArray(structuredDebug.vehicleCandidates) ? structuredDebug.vehicleCandidates : []),
    ...(Array.isArray(rawDebug.vehicleCandidates) ? rawDebug.vehicleCandidates : []),
  ];
  const dateCandidates = [
    result.issueDate || '',
    ...(Array.isArray(structuredDebug.issueDateCandidates) ? structuredDebug.issueDateCandidates : []),
    ...(Array.isArray(rawDebug.issueDateCandidates) ? rawDebug.issueDateCandidates : []),
    rawText,
  ];
  const driverCandidates = [
    result.driverName || '',
    ...(Array.isArray(rawDebug.driverCandidates) ? rawDebug.driverCandidates : []),
    ...(Array.isArray(structuredDebug.driverCandidates) ? structuredDebug.driverCandidates : []),
    rawText.match(/اسم السائق[:\s]+([^\n|]+)/)?.[1] || '',
  ];
  const normalizedDocType = canonicalDocumentType(result.documentType || rawText || '');
  const docType = normalizedDocType && /^((68[ابج])|(126\s+تصديري))$/.test(normalizedDocType)
    ? normalizedDocType
    : (/مستند\s+اصدار\s+الوقود/.test(rawText) ? '68ج' : normalizedDocType);

  return {
    ...createEmptyExtractionResult(),
    ...result,
    documentNumber: normalizeDocumentNumber(result.documentNumber || rawText || ''),
    documentType: docType || (/مستند\s+اصدار\s+الوقود/.test(rawText) ? '68ج' : ''),
    issueDate: pickBestDateValue(dateCandidates, result.issueDate || rawText || ''),
    productType: pickBestProductTypeValue([
      result.productType || '',
      structuredDebug.productType || '',
      rawDebug.productType || '',
      rawText.match(/نوع\s*المنتوج[:\s]+([^\n|]+)/)?.[1] || '',
      rawText.match(/نوع\s*المنتج[:\s]+([^\n|]+)/)?.[1] || '',
    ], result.productType || rawText || ''),
    loadingWarehouseName: sanitizeWarehouseName(normalizeWarehouseCandidate(result.loadingWarehouseName || rawText || '')),
    receiverEntity: isLoadingTemplateName(templateName)
      ? cleanValue(
        result.receiverEntity ||
        rawText.match(/الجهة\s*المرسل\s*(?:اليها|إليها)\s*(?:المشتري)?\s*[:|/\\\-–—\s]*([^\n]+)/i)?.[1] ||
        rawText.match(/الجهة\s*المصدر\s*لها\s*[:|/\\\-–—\s]*([^\n]+)/i)?.[1] ||
        ''
      )
      : (canonicalReceiverEntity(
        repairBrokenWords(result.receiverEntity || ''),
        rawText
      ) || repairBrokenWords(result.receiverEntity || '')),
    vehicleNumberRaw: cleanValue(result.vehicleNumberRaw || structuredDebug.vehicleNumberRaw || rawText || ''),
    vehicleNumber: pickBestVehicleValue(vehicleRawCandidates, result.vehicleNumber || result.vehicleNumberRaw || rawText || ''),
    vehicleGovernorate: cleanValue(result.vehicleGovernorate || ''),
    driverName: (() => {
      const candidates = driverCandidates
        .map((item) => sanitizeDriverName(item || ''))
        .map((item) => cleanValue(item))
        .filter(Boolean);
      const explicit = cleanValue(rawText.match(/اسم السائق[:\s]+([^\n|]+)/)?.[1] || '');
      if (explicit && explicit.split(/\s+/).filter(Boolean).length >= 3) {
        return sanitizeDriverName(explicit);
      }
      const scored = candidates
        .map((candidate) => {
          const normalized = sanitizeDriverName(candidate);
          const tokens = countArabicTokens(normalized);
          let score = tokens * 2;
          if (hasArabicNameShape(normalized)) score += 4;
          if (/\d/.test(normalized)) score -= 5;
          if (/الكمية|المجهزة|المجهز|المركبة|المرسلة|المرسل|الجهة|التحميل|مستودع|مصفى|مصفاة|الشبكة|الذهبي|الذهبية|الاسفلت|الإسفلت|المؤكسد/.test(normalized)) score -= 8;
          if (/(?:^|\s)اسماع?يل(?:\s|$)/.test(normalized)) score += 4;
          if (/(?:^|\s)سماعيل(?:\s|$)/.test(normalized)) score += 4;
          if (/(?:^|\s)اسود(?:\s|$)/.test(normalized)) score += 3;
          if (/(?:^|\s)علي(?:\s|$)/.test(normalized)) score += 2;
          if (/داود|سلمان|شنون|الناصري/.test(normalized)) score += 3;
          return { candidate: normalized, score };
        })
        .sort((a, b) => b.score - a.score);
      return scored[0]?.candidate || sanitizeDriverName(result.driverName || rawText || '');
    })(),
    suppliedQuantityLiters: Math.max(
      Number(result.suppliedQuantityLiters || 0),
      parseQuantityValue(rawText)
    ),
    rawText,
    meta: {
      ...(result.meta || {}),
      fastNormalized: true,
    },
  };
}

function qualityScore(result = {}) {
  const documentNumber = normalizeDocumentNumber(result.documentNumber || '');
  const documentType = canonicalDocumentType(result.documentType || '');
  const issueDate = normalizeDateValue(result.issueDate || '');
  const receiverEntity = repairBrokenWords(result.receiverEntity || '');
  const vehicleNumber = canonicalVehicleValue(result.vehicleNumber || result.vehicleNumberRaw || '');
  const driverName = sanitizeDriverName(result.driverName || '');
  const warehouseName = sanitizeWarehouseName(normalizeWarehouseCandidate(result.loadingWarehouseName || ''));
  const quantity = safeNumber(result.suppliedQuantityLiters, 0);

  let score = 0;
  if (documentNumber) score += 3;
  if (documentType) score += 1.5;
  if (issueDate) score += 1.25;
  if (isGoldenRefinery(receiverEntity) || canonicalReceiverEntity(receiverEntity || '')) score += 1.25;
  if (vehicleNumber) score += 2.5;
  if (driverName) score += hasArabicNameShape(driverName) ? 2.25 : 0.75;
  if (warehouseName) score += hasWarehouseKeyword(warehouseName) ? 1.75 : 0.5;
  if (quantity >= 1000 && quantity <= 60000) score += 0.75;
  score += Object.values(result.ocrMatches || {}).length * 0.1;
  return Number(score.toFixed(3));
}

function pickBestValue(attempts = [], selector, scorer) {
  let best = '';
  let bestScore = -1;

  for (const attempt of attempts) {
    const value = selector(attempt);
    if (!value) continue;
    const score = safeNumber(scorer(value, attempt), 0);
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }

  return best;
}

function mergeOcrMatches(attempts = []) {
  const fieldMap = new Map();

  const pushCandidate = (field, rawValue, confidence = 0.5) => {
    const value = cleanValue(rawValue || '');
    if (!value) return;

    if (!fieldMap.has(field)) {
      fieldMap.set(field, new Map());
    }

    const dedup = fieldMap.get(field);
    const key = value.toLowerCase();
    const current = dedup.get(key);
    const next = {
      value,
      confidence: Number(Math.max(0, Math.min(1, safeNumber(confidence, 0.5))).toFixed(3)),
    };

    if (!current || next.confidence > current.confidence) {
      dedup.set(key, next);
    }
  };

  for (const attempt of attempts) {
    const matches = attempt?.ocrMatches || {};
    for (const [field, match] of Object.entries(matches)) {
      pushCandidate(field, match?.bestValue || '', match?.confidence ?? 0.5);
      const candidates = Array.isArray(match?.candidates) ? match.candidates : [];
      for (const candidate of candidates) {
        if (typeof candidate === 'string') {
          pushCandidate(field, candidate, match?.confidence ?? 0.5);
        } else if (candidate && typeof candidate === 'object') {
          pushCandidate(field, candidate.value || candidate.bestValue || candidate.raw || '', candidate.confidence ?? match?.confidence ?? 0.5);
        }
      }
    }
  }

  const merged = {};
  for (const [field, dedup] of fieldMap.entries()) {
    const candidates = Array.from(dedup.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 6);
    merged[field] = {
      bestValue: candidates[0]?.value || '',
      confidence: candidates[0]?.confidence || 0,
      candidates,
    };
  }
  return merged;
}

function mergeAttempts(attempts = [], { templateName = 'unloading-template' } = {}) {
  const merged = createEmptyExtractionResult();
  const successfulAttempts = attempts.filter((attempt) => attempt?.success);
  const source = successfulAttempts.length ? successfulAttempts : attempts;
  const bestAttempt = source.reduce((best, current) => {
    if (!best) return current;
    return safeNumber(current?.meta?.ensembleScore, 0) > safeNumber(best?.meta?.ensembleScore, 0) ? current : best;
  }, null);

  merged.success = Boolean(bestAttempt?.success);
  merged.documentNumber = pickConsensusValue(
    source,
    (attempt) => normalizeDocumentNumber(attempt?.documentNumber || ''),
    (value) => normalizeDocumentNumber(value || ''),
    () => 1
  );
  merged.documentType = pickConsensusValue(
    source,
    (attempt) => canonicalDocumentType(attempt?.documentType || ''),
    (value) => canonicalDocumentType(value || ''),
    () => 1
  );
  merged.productType = pickConsensusValue(
    source,
    (attempt) => cleanValue(attempt?.productType || ''),
    (value) => cleanValue(value || ''),
    (value) => scoreProductTypeCandidate(value)
  );
  merged.issueDate = pickConsensusValue(
    source,
    (attempt) => normalizeDateValue(attempt?.issueDate || ''),
    (value) => normalizeDateValue(value || ''),
    () => 1
  );
  merged.receiverEntity = isLoadingTemplateName(templateName)
    ? pickConsensusValue(
      source,
      (attempt) => cleanValue(attempt?.receiverEntity || ''),
      (value) => cleanValue(value || ''),
      (value) => scoreReceiverEntityCandidate(value, templateName)
    )
    : pickConsensusValue(
      source,
      (attempt) => repairBrokenWords(attempt?.receiverEntity || ''),
      (value) => repairBrokenWords(value || ''),
      (value) => {
        if (isGoldenRefinery(value)) return 2;
        return canonicalReceiverEntity(value || '') ? 1 : 0;
      }
    );
  merged.receiverEntityValid = isGoldenRefinery(merged.receiverEntity);
  merged.receiverEntityWarning = merged.receiverEntityValid || !merged.receiverEntity
    ? ''
    : 'الجهة المرسل إليها غير صحيحة';

  merged.loadingWarehouseName = pickConsensusValue(
    source,
    (attempt) => sanitizeWarehouseName(normalizeWarehouseCandidate(attempt?.loadingWarehouseName || '')),
    (value) => sanitizeWarehouseName(normalizeWarehouseCandidate(value || '')),
    (value) => (hasWarehouseKeyword(value) ? 2 : 1)
  );
  merged.driverName = pickConsensusValue(
    source,
    (attempt) => sanitizeDriverName(attempt?.driverName || ''),
    (value) => sanitizeDriverName(value || ''),
    (value) => {
      const tokens = countArabicTokens(value);
      let score = tokens * 0.2;
      if (hasArabicNameShape(value)) score += 3;
      if (/\d/.test(value)) score -= 5;
      if (/الكمية|المجهزة|المجهز|المركبة|المرسلة|المرسل|الجهة|التحميل|مستودع|مصفى|مصفاة|الشبكة|الذهبي|الذهبية|الاسفلت|الإسفلت|المؤكسد/.test(value)) score -= 8;
      if (/(?:^|\s)اسماع?يل(?:\s|$)/.test(value)) score += 4;
      if (/(?:^|\s)سماعيل(?:\s|$)/.test(value)) score += 4;
      if (/(?:^|\s)اسود(?:\s|$)/.test(value)) score += 3;
      if (/(?:^|\s)علي(?:\s|$)/.test(value)) score += 2;
      if (/داود|سلمان|شنون|الناصري/.test(value)) score += 3;
      return score;
    }
  );

  const bestVehicleAttempt = source.reduce((best, current) => {
    const bestValue = canonicalVehicleValue(best?.vehicleNumber || best?.vehicleNumberRaw || '');
    const currentValue = canonicalVehicleValue(current?.vehicleNumber || current?.vehicleNumberRaw || '');
    if (!best) return current;
    if (!bestValue && currentValue) return current;
    if (bestValue && !currentValue) return best;
    if ((current?.meta?.ensembleScore || 0) > (best?.meta?.ensembleScore || 0)) return current;
    return best;
  }, null);

  merged.vehicleNumber = cleanValue(bestVehicleAttempt?.vehicleNumber || '');
  merged.vehicleNumberRaw = cleanValue(bestVehicleAttempt?.vehicleNumberRaw || '');
  merged.vehicleGovernorate = cleanValue(bestVehicleAttempt?.vehicleGovernorate || '');
  const quantityConsensus = pickConsensusValue(
    source,
    (attempt) => safeNumber(attempt?.suppliedQuantityLiters, 0),
    (value) => Number(value) || 0,
    (value) => (value >= 1000 && value <= 60000 ? 2 : 0)
  );
  merged.suppliedQuantityLiters = Number(quantityConsensus || 0);
  merged.rawText = cleanValue(bestAttempt?.rawText || '');
  merged.ocrMatches = mergeOcrMatches(source);
  merged.meta = {
    ...(bestAttempt?.meta || {}),
    ensemble: {
      attempts: attempts.map((attempt, index) => ({
        index: index + 1,
        success: Boolean(attempt?.success),
        score: safeNumber(attempt?.meta?.ensembleScore, 0),
        profile: attempt?.meta?.preprocessing?.profileName || attempt?.meta?.profileName || '',
        durationMs: safeNumber(attempt?.meta?.durationMs, 0),
      })),
      bestAttemptIndex: source.findIndex((attempt) => attempt === bestAttempt) + 1,
      attemptsCount: attempts.length,
    },
  };

  if (isLoadingTemplateName(templateName) && merged.receiverEntity) {
    merged.receiverEntity = cleanValue(merged.receiverEntity);
  }

  return merged;
}

function hasCompleteCoreFields(result = {}, { templateName = '' } = {}) {
  const loadingMode = isLoadingTemplateName(templateName);
  if (loadingMode) {
    return Boolean(
      result.documentNumber
        && result.documentType
        && result.issueDate
        && result.loadingWarehouseName
        && result.receiverEntity
        && result.vehicleNumber
        && result.driverName
        && result.productType
    );
  }

  return Boolean(
    result.documentNumber
      && result.documentType
      && result.issueDate
      && result.loadingWarehouseName
      && result.vehicleNumber
      && result.driverName
  );
}

async function runOcrEnsemble({
  imagePath,
  templateName = 'unloading-template',
  mode = 'default',
  runner = runFastOcr,
} = {}) {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new Error('runOcrEnsemble requires a valid image file path');
  }

  const profiles = OCR_PROFILES[mode] || OCR_PROFILES.default;
  const attempts = [];
  const startedAt = Date.now();

  for (const profile of profiles) {
    try {
      const result = await runner(imagePath, templateName, profile);
      attempts.push({
        ...normalizeFastResult(result),
        success: Boolean(result?.success !== false),
        meta: {
          ...(result?.meta || {}),
          profileName: profile.profileName || profile.id,
        },
      });

      const latest = mergeAttempts(attempts, { templateName });
      if (hasCompleteCoreFields(latest, { templateName })) {
        break;
      }
    } catch (error) {
      attempts.push({
        ...createEmptyExtractionResult(),
        success: false,
        meta: {
          profileName: profile.profileName || profile.id,
          ocrError: error?.message || 'OCR attempt failed',
        },
      });
    }
  }

  for (const attempt of attempts) {
    attempt.meta = {
      ...(attempt.meta || {}),
      ensembleScore: qualityScore(attempt),
    };
  }

  const merged = mergeAttempts(attempts, { templateName });
  merged.meta = {
    ...(merged.meta || {}),
    ocrMode: mode,
    totalDurationMs: Date.now() - startedAt,
  };

  const firstSuccess = attempts.find((attempt) => attempt?.success);
  if (!merged.success && !firstSuccess) {
    const combinedError = attempts
      .map((attempt) => attempt?.meta?.ocrError)
      .filter(Boolean)
      .join(' | ');
    merged.meta.ocrError = combinedError || 'OCR ensemble failed';
  }

  return merged;
}

module.exports = {
  OCR_PROFILES,
  qualityScore,
  mergeAttempts,
  runOcrEnsemble,
};
