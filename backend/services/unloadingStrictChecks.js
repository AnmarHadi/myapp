const {
  sanitizeDriverName,
  cleanValue,
  normalizeTextKey,
} = require('./unloadingFieldReader');

const CRITICAL_FIELDS = ['vehicleNumber', 'driverName', 'loadingWarehouseName'];
const VEHICLE_PATTERN = /^(?:\d{2}[A-Z]\d{4,6}|[\u0621-\u064A]\d{4,6}(?:\/[\u0600-\u06FF\s]+)?)$/;

const DRIVER_BLOCK_TOKENS = [
  '\u0627\u0644\u0647\u0648\u064a\u0629',
  '\u0627\u0644\u0647\u0648\u064a\u0647',
  '\u0627\u0633\u0645 \u0627\u0644\u0627\u0645',
  '\u0627\u0633\u0645 \u0627\u0644\u0623\u0645',
  '\u062a\u0627\u0631\u064a\u062e',
  '\u0627\u0644\u062a\u0648\u0642\u064a\u0639',
  '\u0627\u0644\u0648\u0638\u064a\u0641\u064a',
];

const REASON_MESSAGES = {
  strict_check_missing: 'Strict check payload is missing',
  strict_check_not_confirmed: 'Field strict check is not confirmed',
  vehicle_missing: 'Vehicle number was not extracted',
  vehicle_pattern_invalid: 'Vehicle number format is invalid',
  vehicle_low_confidence: 'Vehicle OCR confidence is too low',
  vehicle_not_mapped_db: 'Vehicle was not matched to database',
  vehicle_db_mismatch: 'Vehicle text does not match selected vehicle',
  vision_disagreement: 'Vision review disagrees with OCR extraction',
  cross_line_pollution: 'Detected OCR pollution from neighboring rows',
  driver_missing: 'Driver name was not extracted',
  driver_name_too_short: 'Driver name does not contain enough Arabic segments',
  driver_low_confidence: 'Driver OCR confidence is too low',
  driver_not_mapped_db: 'Driver was not matched to database',
  driver_db_mismatch: 'Driver text does not match selected driver',
  warehouse_missing: 'Loading warehouse was not extracted',
  warehouse_not_in_whitelist: 'Warehouse does not match approved whitelist',
  warehouse_low_confidence: 'Warehouse OCR confidence is too low',
  warehouse_not_mapped_db: 'Warehouse was not matched to database',
  warehouse_db_mismatch: 'Warehouse text does not match selected warehouse',
};

function toWesternDigits(value = '') {
  return String(value).replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
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

function normalizeWarehouseCandidate(value = '') {
  return String(value || '')
    .replace(/\u0627\u0644\u062c\u0647\u0629\s*\u0627\u0644\u0645\u062c\u0647\u0632\u0629/gi, ' ')
    .replace(/\u0627\u0644\u062c\u0647\u0629\s*\u0627\u0644\u0645\u062c\u0647\u0632\u0629\s*\/?\s*\u0645\u0633\u062a\u0648\u062f\u0639\s*\u0627\u0644\u062a\u062d\u0645\u064a\u0644/gi, ' ')
    .replace(/\u0645\u062c\u0647\u0632\u0629/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArabicWarehouse(value = '') {
  return toWesternDigitsSafe(String(value || ''))
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeWarehouseStrictValue(value = '') {
  let raw = normalizeWarehouseCandidate(value);
  raw = cleanValue(raw);
  if (!raw) return '';

  raw = toWesternDigitsSafe(raw)
    .replace(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\b(?:الاصدار|اصدار|الاصدر|اصدر)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let normalized = normalizeArabicWarehouse(raw)
    .replace(/مصني/g, 'مصفى')
    .replace(/مصفي/g, 'مصفى')
    .replace(/مصفاه/g, 'مصفاة')
    .replace(/السماوه/g, 'السماوة')
    .replace(/السماره/g, 'السماوة')
    .replace(/الذاصريه/g, 'الناصرية')
    .replace(/الذاصريه/g, 'الناصرية')
    .replace(/\s+/g, ' ')
    .trim();

  if (/(مصفى|مصفاة)/.test(normalized) && normalized.includes('السماوة')) {
    return 'مصفى السماوة';
  }
  if (/(مصفى|مصفاة)/.test(normalized) && normalized.includes('الناصرية')) {
    return 'مصفى الناصرية';
  }

  return normalized;
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
  for (const [alias, canonical] of governorateEntries) {
    const haystack = normalizeTextKey(normalized);
    const aliasKey = normalizeTextKey(alias);
    if (haystack.includes(aliasKey)) {
      governorate = canonical;
      break;
    }
  }

  const embedded = normalized.match(/(\d{4,6})\s*\/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF\s]+))?/);
  if (embedded) {
    const embeddedGovernorate = normalizeGovernorateName(embedded[3] || governorate);
    return {
      digits: embedded[1],
      letter: normalizeArabicVehicleLetter(embedded[2]),
      governorate: embeddedGovernorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(embedded[2])}${embedded[1]}`,
      canonical: `${normalizeArabicVehicleLetter(embedded[2])}${embedded[1]}${embeddedGovernorate ? `/${embeddedGovernorate}` : ''}`,
    };
  }

  const numberLetter = normalized.match(/^(\d{4,6})\s+([\u0621-\u064A])$/);
  if (numberLetter) {
    return {
      digits: numberLetter[1],
      letter: normalizeArabicVehicleLetter(numberLetter[2]),
      governorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(numberLetter[2])}${numberLetter[1]}`,
      canonical: `${normalizeArabicVehicleLetter(numberLetter[2])}${numberLetter[1]}${governorate ? `/${governorate}` : ''}`,
    };
  }

  const letterNumber = normalized.match(/^([\u0621-\u064A])\s*(\d{4,6})$/);
  if (letterNumber) {
    return {
      digits: letterNumber[2],
      letter: normalizeArabicVehicleLetter(letterNumber[1]),
      governorate,
      vehicleNumber: `${normalizeArabicVehicleLetter(letterNumber[1])}${letterNumber[2]}`,
      canonical: `${normalizeArabicVehicleLetter(letterNumber[1])}${letterNumber[2]}${governorate ? `/${governorate}` : ''}`,
    };
  }

  const latinDigitsFirst = normalized.match(/^(\d{4,6})\s*([A-Za-z])(?:\s+([\u0600-\u06FF\s]+))?$/);
  if (latinDigitsFirst) {
    const letter = normalizeArabicVehicleLetter(latinDigitsFirst[2]);
    const latinGovernorate = normalizeGovernorateName(latinDigitsFirst[3] || governorate);
    return {
      digits: latinDigitsFirst[1],
      letter,
      governorate: latinGovernorate,
      vehicleNumber: `${letter}${latinDigitsFirst[1]}`,
      canonical: `${letter}${latinDigitsFirst[1]}${latinGovernorate ? `/${latinGovernorate}` : ''}`,
    };
  }

  const latinLetterFirst = normalized.match(/^([A-Za-z])\s*(\d{4,6})(?:\s+([\u0600-\u06FF\s]+))?$/);
  if (latinLetterFirst) {
    const letter = normalizeArabicVehicleLetter(latinLetterFirst[1]);
    const latinGovernorate = normalizeGovernorateName(latinLetterFirst[3] || governorate);
    return {
      digits: latinLetterFirst[2],
      letter,
      governorate: latinGovernorate,
      vehicleNumber: `${letter}${latinLetterFirst[2]}`,
      canonical: `${letter}${latinLetterFirst[2]}${latinGovernorate ? `/${latinGovernorate}` : ''}`,
    };
  }

  return null;
}

function canonicalVehicleValue(value = '') {
  const arabicParsed = parseArabicStyleVehicle(value);
  if (arabicParsed?.canonical) return arabicParsed.canonical;

  const raw = cleanValue(toWesternDigitsSafe(value)).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';

  const slashDigitsFirst = raw.match(/^(\d{4,6})\/(\d{2}[A-Z])$/i);
  if (slashDigitsFirst) return `${slashDigitsFirst[2]}${slashDigitsFirst[1]}`;

  const slashPrefixFirst = raw.match(/^(\d{2}[A-Z])\/(\d{4,6})$/i);
  if (slashPrefixFirst) return `${slashPrefixFirst[1]}${slashPrefixFirst[2]}`;

  const embeddedDigitsFirst = raw.match(/(\d{4,6})\/(\d{2}[A-Z])/i);
  if (embeddedDigitsFirst) return `${embeddedDigitsFirst[2]}${embeddedDigitsFirst[1]}`;

  const embeddedPrefixFirst = raw.match(/(\d{2}[A-Z])\/(\d{4,6})/i);
  if (embeddedPrefixFirst) return `${embeddedPrefixFirst[1]}${embeddedPrefixFirst[2]}`;

  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const direct = compact.match(/^(\d{2}[A-Z]\d{4,6})$/i);
  if (direct) return direct[1];

  return compact;
}

function isVehiclePatternValid(value = '') {
  const canonical = canonicalVehicleValue(value);
  return VEHICLE_PATTERN.test(canonical);
}

function sanitizeDriverForStrict(value = '') {
  return sanitizeDriverName(value)
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeArabic(value = '') {
  return String(value || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[\u0621-\u064A]{2,}$/.test(token));
}

function normalizeReasonField(field = '') {
  if (field === 'vehicleNumber') return 'vehicleNumber';
  if (field === 'driverName') return 'driverName';
  if (field === 'loadingWarehouseName') return 'loadingWarehouseName';
  return field;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizeCandidateItem(candidate, fallbackConfidence = 0.5) {
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    return { value: cleanValue(candidate), confidence: fallbackConfidence };
  }
  if (typeof candidate === 'object') {
    const value = cleanValue(candidate.value || candidate.bestValue || candidate.raw || '');
    const confidence = Number(candidate.confidence ?? fallbackConfidence);
    if (!value) return null;
    return {
      value,
      confidence: Number.isFinite(confidence) ? confidence : fallbackConfidence,
    };
  }
  return null;
}

function collectTopCandidates({
  directValue = '',
  ocrMatch = {},
  normalizer = (value) => cleanValue(value),
  limit = 5,
}) {
  const seen = new Set();
  const out = [];
  const rawCandidates = [];

  const pushCandidate = (value, confidence = 0.5) => {
    const normalized = cleanValue(normalizer(value));
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      value: normalized,
      confidence: Number(Number(confidence || 0).toFixed(3)),
    });
  };

  if (directValue) {
    rawCandidates.push({ value: directValue, confidence: ocrMatch?.confidence ?? 0.55 });
  }

  for (const c of ensureArray(ocrMatch?.candidates)) {
    const candidate = normalizeCandidateItem(c, ocrMatch?.confidence ?? 0.5);
    if (candidate) rawCandidates.push(candidate);
  }

  const rawSplit = String(ocrMatch?.raw || '')
    .split(/[|]/)
    .map((part) => cleanValue(part))
    .filter(Boolean)
    .slice(0, 10);
  for (const item of rawSplit) {
    rawCandidates.push({ value: item, confidence: ocrMatch?.confidence ?? 0.45 });
  }

  rawCandidates
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .forEach((item) => pushCandidate(item.value, item.confidence));

  return out.slice(0, limit);
}

function finalizeFieldCheck(check = {}) {
  const reasonCodes = Array.from(new Set(ensureArray(check.reasonCodes).filter(Boolean)));
  const status = check.status
    || (reasonCodes.length ? 'review_required' : 'confirmed');

  return {
    field: check.field,
    status,
    value: check.value || '',
    normalizedValue: check.normalizedValue || '',
    reasonCodes,
    ocrConfidence: Number(Number(check.ocrConfidence || 0).toFixed(3)),
    topCandidates: ensureArray(check.topCandidates).slice(0, 5),
    matchedId: check.matchedId || null,
  };
}

function evaluateVehicleStrict({ value = '', rawValue = '', ocrMatch = {}, matchedEntity = null, forSave = false }) {
  const canonical = canonicalVehicleValue(value || rawValue || ocrMatch?.bestValue || '');
  const topCandidates = collectTopCandidates({
    directValue: value || rawValue || ocrMatch?.bestValue || '',
    ocrMatch,
    normalizer: canonicalVehicleValue,
  });

  const reasonCodes = [];
  const ocrConfidence = Number(ocrMatch?.confidence ?? (forSave ? 1 : 0));
  const matchedCanonical = matchedEntity
    ? canonicalVehicleValue(
      `${matchedEntity.vehicleNumber || ''}${matchedEntity.governorate ? `/${matchedEntity.governorate}` : ''}`
    )
    : '';
  const dbConfirmed = Boolean(matchedEntity && canonical && matchedCanonical && canonical === matchedCanonical);

  if (!canonical) {
    reasonCodes.push('vehicle_missing');
  } else if (!VEHICLE_PATTERN.test(canonical)) {
    reasonCodes.push('vehicle_pattern_invalid');
  }

  const raw = cleanValue(rawValue || ocrMatch?.raw || value).toUpperCase();
  if (!dbConfirmed && /\d{4,6}\/\d{3}(?:\D|$)/.test(raw)) {
    reasonCodes.push('cross_line_pollution');
  }

  if (!forSave && !dbConfirmed && canonical && ocrConfidence < 0.6) {
    reasonCodes.push('vehicle_low_confidence');
  }

  const status = reasonCodes.includes('vehicle_missing') ? 'rejected' : undefined;

  return finalizeFieldCheck({
    field: 'vehicleNumber',
    status,
    value: value || canonical || '',
    normalizedValue: canonical,
    reasonCodes,
    ocrConfidence,
    topCandidates,
    matchedId: matchedEntity?._id || null,
  });
}

function evaluateDriverStrict({ value = '', ocrMatch = {}, matchedEntity = null, forSave = false }) {
  const normalized = sanitizeDriverForStrict(value || ocrMatch?.bestValue || '');
  const topCandidates = collectTopCandidates({
    directValue: normalized,
    ocrMatch,
    normalizer: sanitizeDriverForStrict,
  });
  const tokens = tokenizeArabic(normalized);
  const reasonCodes = [];
  const ocrConfidence = Number(ocrMatch?.confidence ?? (forSave ? 1 : 0));
  const matchedKey = matchedEntity
    ? normalizeTextKey(sanitizeDriverForStrict(matchedEntity.name || ''))
    : '';
  const sourceKey = normalizeTextKey(normalized);
  const dbConfirmed = Boolean(matchedEntity && sourceKey && matchedKey && sourceKey === matchedKey);

  if (!normalized) {
    reasonCodes.push('driver_missing');
  } else {
    if (tokens.length < 3) reasonCodes.push('driver_name_too_short');
    if (!dbConfirmed && tokens.length > 6) reasonCodes.push('cross_line_pollution');

    const lowered = normalizeTextKey(value || normalized);
    if (!dbConfirmed && (/\d{2,}/.test(value || '') || DRIVER_BLOCK_TOKENS.some((token) => lowered.includes(normalizeTextKey(token))))) {
      reasonCodes.push('cross_line_pollution');
    }
  }

  if (!forSave && !dbConfirmed && normalized && ocrConfidence < 0.58) {
    reasonCodes.push('driver_low_confidence');
  }

  if (!matchedEntity) {
    reasonCodes.push('driver_not_mapped_db');
  } else if (normalized) {
    if (!sourceKey || !matchedKey || sourceKey !== matchedKey) {
      reasonCodes.push('driver_db_mismatch');
    }
  }

  const status = reasonCodes.includes('driver_missing') ? 'rejected' : undefined;

  return finalizeFieldCheck({
    field: 'driverName',
    status,
    value: normalized,
    normalizedValue: normalized,
    reasonCodes,
    ocrConfidence,
    topCandidates,
    matchedId: matchedEntity?._id || null,
  });
}

function buildWarehouseWhitelistMap(warehouseWhitelist = []) {
  const map = new Map();
  for (const item of ensureArray(warehouseWhitelist)) {
    const name = cleanValue(item?.name || item?.value || '');
    if (!name) continue;
    const sanitized = sanitizeWarehouseStrictValue(name);
    const key = normalizeTextKey(sanitized);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return map;
}

function evaluateWarehouseStrict({
  value = '',
  ocrMatch = {},
  matchedEntity = null,
  warehouseWhitelist = [],
  forSave = false,
}) {
  const normalized = sanitizeWarehouseStrictValue(value || ocrMatch?.bestValue || '');
  const whitelistMap = buildWarehouseWhitelistMap(warehouseWhitelist);
  const whitelistHit = whitelistMap.get(normalizeTextKey(normalized || '')) || null;

  const topCandidates = collectTopCandidates({
    directValue: normalized,
    ocrMatch,
    normalizer: (candidate) => sanitizeWarehouseStrictValue(candidate),
  });

  const reasonCodes = [];
  const ocrConfidence = Number(ocrMatch?.confidence ?? (forSave ? 1 : 0));
  const matchedWarehouse = matchedEntity || whitelistHit;
  const matchedKey = matchedWarehouse
    ? normalizeTextKey(sanitizeWarehouseStrictValue(matchedWarehouse.name || ''))
    : '';
  const normalizedKey = normalizeTextKey(normalized || '');
  const dbConfirmed = Boolean(matchedWarehouse && normalizedKey && matchedKey && normalizedKey === matchedKey);

  if (!normalized) {
    reasonCodes.push('warehouse_missing');
  }

  if (normalized && !whitelistHit) {
    reasonCodes.push('warehouse_not_in_whitelist');
  }

  if (!forSave && !dbConfirmed && normalized && ocrConfidence < 0.52) {
    reasonCodes.push('warehouse_low_confidence');
  }

  if (!matchedWarehouse) {
    reasonCodes.push('warehouse_not_mapped_db');
  } else {
    if (normalizedKey && matchedKey && normalizedKey !== matchedKey) {
      reasonCodes.push('warehouse_db_mismatch');
    }
  }

  const status = reasonCodes.includes('warehouse_missing') ? 'rejected' : undefined;

  return finalizeFieldCheck({
    field: 'loadingWarehouseName',
    status,
    value: normalized,
    normalizedValue: normalizeTextKey(normalized || ''),
    reasonCodes,
    ocrConfidence,
    topCandidates,
    matchedId: matchedWarehouse?._id || null,
  });
}

function blockingErrorsFromStrictChecks(strictChecks = {}) {
  const errors = [];

  for (const field of CRITICAL_FIELDS) {
    const check = strictChecks?.[field];
    if (!check) {
      errors.push({
        field: normalizeReasonField(field),
        reasonCode: 'strict_check_missing',
        message: REASON_MESSAGES.strict_check_missing,
      });
      continue;
    }

    if (check.status !== 'confirmed') {
      const reasons = ensureArray(check.reasonCodes).filter(Boolean);
      if (!reasons.length) {
        errors.push({
          field: normalizeReasonField(field),
          reasonCode: 'strict_check_not_confirmed',
          message: REASON_MESSAGES.strict_check_not_confirmed,
        });
      } else {
        for (const reasonCode of reasons) {
          errors.push({
            field: normalizeReasonField(field),
            reasonCode,
            message: REASON_MESSAGES[reasonCode] || reasonCode,
          });
        }
      }
    }
  }

  return errors;
}

function buildUnloadingStrictChecks({
  values = {},
  ocrMatches = {},
  entities = {},
  warehouseWhitelist = [],
  options = {},
}) {
  const forSave = !!options.forSave;
  const strictChecks = {
    vehicleNumber: evaluateVehicleStrict({
      value: values.vehicleNumber || '',
      rawValue: values.vehicleNumberRaw || '',
      ocrMatch: ocrMatches.vehicle || {},
      matchedEntity: entities.vehicle || null,
      forSave,
    }),
    driverName: evaluateDriverStrict({
      value: values.driverName || '',
      ocrMatch: ocrMatches.driver || {},
      matchedEntity: entities.driver || null,
      forSave,
    }),
    loadingWarehouseName: evaluateWarehouseStrict({
      value: values.loadingWarehouseName || '',
      ocrMatch: ocrMatches.loadingWarehouse || {},
      matchedEntity: entities.loadingWarehouse || null,
      warehouseWhitelist,
      forSave,
    }),
  };

  const blockingErrors = blockingErrorsFromStrictChecks(strictChecks);
  const canSave = blockingErrors.length === 0;

  return {
    strictChecks,
    blockingErrors,
    canSave,
    resolvedIds: {
      loadingWarehouseId:
        strictChecks.loadingWarehouseName.status === 'confirmed'
          ? strictChecks.loadingWarehouseName.matchedId
          : null,
      vehicleId:
        strictChecks.vehicleNumber.status === 'confirmed'
          ? strictChecks.vehicleNumber.matchedId
          : null,
      driverId:
        strictChecks.driverName.status === 'confirmed'
          ? strictChecks.driverName.matchedId
          : null,
    },
  };
}

module.exports = {
  CRITICAL_FIELDS,
  VEHICLE_PATTERN,
  REASON_MESSAGES,
  normalizeWarehouseCandidate,
  canonicalVehicleValue,
  isVehiclePatternValid,
  sanitizeDriverForStrict,
  sanitizeWarehouseStrictValue,
  buildUnloadingStrictChecks,
  blockingErrorsFromStrictChecks,
  buildWarehouseWhitelistMap,
};
