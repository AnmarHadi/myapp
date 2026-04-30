const Groq = require('groq-sdk');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const VehicleOwner = require('../models/Contractor');
const VehicleType = require('../models/VehicleType');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EMPTY_EXTRACT = {
  driverName: '',
  motherName: '',
  birthDate: '',
  nationalId: '',
  address: '',
  vehicleNumber: '',
  governorate: '',
  vehicleTypeName: '', // المقصود هنا ماركة المركبة
  ownerName: '',
  annualExpiry: '',
  rawText: '',
};

const IRAQI_GOVERNORATES = [
  'بغداد',
  'بصرة',
  'نينوى',
  'أربيل',
  'كركوك',
  'أنبار',
  'بابل',
  'ديالى',
  'ذي قار',
  'دهوك',
  'سليمانية',
  'صلاح الدين',
  'واسط',
  'ميسان',
  'مثنى',
  'نجف',
  'كربلاء',
  'قادسية',
];

const toWesternDigits = (value = '') => {
  const map = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
  };

  return String(value).replace(/[٠-٩]/g, (d) => map[d] || d);
};

const normalizeArabic = (text = '') =>
  toWesternDigits(
    String(text)
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ـ/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

const cleanValue = (value = '') =>
  String(value)
    .replace(/^[\s:：\-–—|/\\.,;]+/, '')
    .replace(/[\s:：\-–—|/\\.,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeTextKey = (value = '') =>
  normalizeArabic(String(value)).trim().toLowerCase();

const normalizeVehicleNumber = (value = '') =>
  toWesternDigits(String(value))
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();

const governorateMap = {
  بغداد: 'بغداد',
  البغداد: 'بغداد',

  بصره: 'بصرة',
  البصره: 'بصرة',
  البصرة: 'بصرة',
  بصرة: 'بصرة',

  نينوى: 'نينوى',
  نينوي: 'نينوى',

  اربيل: 'أربيل',
  أربيل: 'أربيل',

  كركوك: 'كركوك',

  الانبار: 'أنبار',
  أنبار: 'أنبار',
  الأنبار: 'أنبار',

  بابل: 'بابل',
  حله: 'بابل',
  حلة: 'بابل',

  ديالى: 'ديالى',
  ديالي: 'ديالى',

  'ذي قار': 'ذي قار',
  ذيقار: 'ذي قار',

  دهوك: 'دهوك',

  سليمانيه: 'سليمانية',
  السليمانيه: 'سليمانية',
  السليمانية: 'سليمانية',
  سليمانية: 'سليمانية',

  'صلاح الدين': 'صلاح الدين',
  صلاحالدين: 'صلاح الدين',

  واسط: 'واسط',

  ميسان: 'ميسان',

  مثنى: 'مثنى',
  المثنى: 'مثنى',

  نجف: 'نجف',
  النجف: 'نجف',

  كربلاء: 'كربلاء',
  كربلا: 'كربلاء',

  القادسيه: 'قادسية',
  القادسية: 'قادسية',
  قادسيه: 'قادسية',
  قادسية: 'قادسية',
};

const knownGovernorates = Object.keys(governorateMap).sort(
  (a, b) => b.length - a.length
);

function safeString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function onlyOneSpace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function stripLeadingAl(value = '') {
  const v = cleanValue(value);
  if (!v) return '';
  return v.replace(/^ال/, '').trim();
}

function joinNameParts(parts = []) {
  return onlyOneSpace(
    parts
      .map((p) => cleanValue(p || ''))
      .filter(Boolean)
      .join(' ')
  );
}

function splitNameParts(value = '') {
  return cleanValue(value)
    .split(/\s+/)
    .map((x) => cleanValue(x))
    .filter(Boolean);
}

function normalizeGovernorateForDropdown(value = '') {
  const cleaned = cleanValue(value);
  if (!cleaned) return '';

  const normalized = normalizeArabic(cleaned);
  const mapped = governorateMap[normalized] || cleaned;

  return stripLeadingAl(mapped);
}

function buildDriverNameFromParts(data = {}) {
  return joinNameParts([
    data.driverFirstName,
    data.driverFatherName,
    data.driverGrandfatherName,
    data.driverFourthName,
    data.driverSurname,
  ]);
}

function normalizeArabicLetter(value = '') {
  const v = cleanValue(value);
  if (!v) return '';
  const latinMap = {
    F: 'ف',
    f: 'ف',
    A: 'ا',
    a: 'ا',
    B: 'ب',
    b: 'ب',
    C: 'ج',
    c: 'ج',
  };
  if (latinMap[v]) return latinMap[v];
  const match = v.match(/[\u0621-\u064A]/);
  return match ? match[0] : '';
}

function normalizeEnglishPrefix(value = '') {
  const normalized = onlyOneSpace(toWesternDigits(String(value)))
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  if (!normalized) return '';

  if (
    /^\d{1,3}[A-Z]{1,3}$/.test(normalized) ||
    /^[A-Z]{1,3}\d{1,3}$/.test(normalized)
  ) {
    return normalized;
  }

  return '';
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanPersonNameValue(value = '') {
  return cleanValue(value)
    .replace(
      /(?:اسم\s*الزوجة|اسم\s*الزوجه|الزوجة|الزوجه|اسم\s*الزوج|الزوج)\s*.*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeLabeledField(line = '') {
  const n = normalizeArabic(line);
  const labels = [
    'الاسم الرباعي واللقب',
    'اسم السائق',
    'اسم الاب',
    'جد الاب',
    'الجد',
    'اللقب',
    'تاريخ الولاده',
    'تاريخ الميلاد',
    'محل الولاده',
    'المحافظه',
    'المحلة',
    'محله',
    'الزقاق',
    'رقم الدار',
    'العنوان',
    'عنوان السكن',
    'اقرب نقطه داله',
    'رقم البطاقه التموينيه',
    'رقم الجنسيه',
    'رقم الجنسيه الموحده',
    'رقم البطاقه الوطنيه',
    'رقم الوطنية',
    'جهه الاصدار',
    'اسم الام',
    'اسم الام الثلاثي',
    'اسم الزوجه',
    'رقم العجله',
    'رقم المركبه',
    'رقم العجله والعائديه',
    'رقم العجله مع الحرف والعائديه',
    'نوع العجله',
    'نوع المركبه',
    'لون العجله',
    'موديل العجله',
    'اسم الحائز',
    'اسم المالك',
    'اسم المالك في السنويه',
    'رقم الشاصي',
    'رقم السنويه',
    'تاريخ انتهاء السنويه',
    'تاريخ نفاذ السنويه',
    'رقم الهاتف',
    'رقم بطاقه السكن',
    'جهه اصدار بطاقه السكن',
  ];

  return labels.some((label) => n.includes(label));
}

function extractArabicLetterAndGovernorate(text = '') {
  const raw = cleanValue(text);
  if (!raw) return { arabicLetter: '', governorate: '' };

  const normalized = normalizeArabic(raw);
  const parts = raw.split(/\s+/).filter(Boolean);

  let arabicLetter = '';
  for (const p of parts) {
    if (/^[\u0621-\u064A]$/.test(p) || /^[A-Za-z]$/.test(p)) {
      arabicLetter = normalizeArabicLetter(p);
      break;
    }

    if (/^[\u0621-\u064A]\d{3,8}$/.test(p) || /^[A-Za-z]\d{3,8}$/.test(p)) {
      arabicLetter = normalizeArabicLetter(p[0]);
      break;
    }
  }

  let governorate = '';
  for (const gov of knownGovernorates) {
    if (
      normalized === gov ||
      normalized.includes(` ${gov}`) ||
      normalized.includes(`${gov} `) ||
      normalized.includes(`/${gov}`) ||
      normalized.includes(`${gov}/`)
    ) {
      governorate = normalizeGovernorateForDropdown(governorateMap[gov] || gov);
      break;
    }
  }

  return {
    arabicLetter: normalizeArabicLetter(arabicLetter),
    governorate,
  };
}

function extractLabeledValueFromRawText(rawText = '', labels = [], options = {}) {
  const text = String(rawText || '');
  if (!text.trim() || !labels.length) return '';

  const { skipIfLineMatches = [], skipIfValueMatches = [] } = options;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const shouldSkip = (value, patterns = []) =>
    patterns.some((pattern) => pattern.test(normalizeArabic(value)));

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (shouldSkip(line, skipIfLineMatches)) continue;

    for (const label of labels) {
      const escaped = escapeRegex(label);

      const sameLinePatterns = [
        new RegExp(`^\\s*${escaped}\\s*[:：\\-–—|/]\\s*(.+)$`, 'i'),
        new RegExp(`^\\s*${escaped}\\s+(.+)$`, 'i'),
        new RegExp(`^(.+?)\\s*[:：\\-–—|/]\\s*${escaped}\\s*$`, 'i'),
        new RegExp(`^(.+?)\\s+${escaped}\\s*$`, 'i'),
      ];

      for (const pattern of sameLinePatterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          const value = cleanValue(match[1]);
          if (!value) continue;
          if (shouldSkip(value, skipIfValueMatches)) continue;
          return value;
        }
      }

      if (normalizeArabic(line) === normalizeArabic(label)) {
        const nextCandidates = [
          cleanValue(lines[idx + 1] || ''),
          cleanValue(lines[idx + 2] || ''),
        ].filter(Boolean);

        for (const candidate of nextCandidates) {
          if (!candidate) continue;
          if (looksLikeLabeledField(candidate)) continue;
          if (shouldSkip(candidate, skipIfValueMatches)) continue;
          return candidate;
        }

        const prevCandidate = cleanValue(lines[idx - 1] || '');
        if (prevCandidate && !looksLikeLabeledField(prevCandidate)) {
          if (!shouldSkip(prevCandidate, skipIfValueMatches)) {
            return prevCandidate;
          }
        }
      }
    }
  }

  return '';
}

function extractMotherNameFromRawText(rawText = '') {
  const value = extractLabeledValueFromRawText(
    rawText,
    [
      'اسم الام الثلاثي',
      'اسم الأم الثلاثي',
      'اسم الام',
      'اسم الأم',
      'اسم الوالدة',
      'الوالدة',
      'الام',
      'الأم',
    ],
    {
      skipIfLineMatches: [/زوج/],
      skipIfValueMatches: [/زوج/],
    }
  );

  return cleanPersonNameValue(value);
}

function pickBestMotherName(input = {}) {
  const rawMother = cleanPersonNameValue(
    extractMotherNameFromRawText(input.rawText)
  );

  const first = cleanValue(input.motherFirstName || '');
  const father = cleanValue(input.motherFatherName || '');
  const grandfather = cleanValue(input.motherGrandfatherName || '');
  const surname = cleanValue(input.motherSurname || '');

  const aiMotherFull = joinNameParts([first, father, grandfather, surname]);

  const rawParts = splitNameParts(rawMother);
  const aiParts = splitNameParts(aiMotherFull);

  if (aiParts.length >= 2) return aiMotherFull;
  if (rawParts.length >= 2) return rawMother;

  const firstName = rawMother || first;
  const merged = joinNameParts([firstName, father, grandfather, surname]);

  if (splitNameParts(merged).length >= 2) return merged;

  return rawMother || aiMotherFull || '';
}

function extractEnglishPrefixToken(text = '') {
  const value = toWesternDigits(String(text || ''))
    .replace(/[_،,:؛|/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  if (!value) return '';

  const direct = value.match(/\b(\d{1,3}[A-Z]{1,3}|[A-Z]{1,3}\d{1,3})\b/);
  return direct?.[1] || '';
}

function extractCoreDigits(text = '') {
  const value = toWesternDigits(String(text || ''));
  const matches = value.match(/\d{3,8}/g) || [];
  if (!matches.length) return '';
  return matches.sort((a, b) => b.length - a.length)[0] || '';
}

function removeGovernorateWords(text = '', governorate = '') {
  let value = String(text || '');
  if (!governorate) return value;

  const variants = Object.keys(governorateMap).filter(
    (k) => governorateMap[k] === governorate
  );

  for (const variant of variants) {
    const escaped = escapeRegex(variant);
    value = value.replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ');
  }

  return value.replace(/\s+/g, ' ').trim();
}

function parseCombinedPlateValue(value = '') {
  const raw = cleanValue(toWesternDigits(value));
  if (!raw) {
    return {
      plateNumberCore: '',
      plateEnglishPrefix: '',
      plateArabicLetter: '',
      plateGovernorate: '',
      vehicleNumber: '',
      governorate: '',
    };
  }

  const compact = raw.replace(/\s+/g, ' ').trim();

  const englishPrefix = normalizeEnglishPrefix(extractEnglishPrefixToken(compact));
  const core = extractCoreDigits(compact);

  if (englishPrefix && core) {
    return {
      plateNumberCore: core,
      plateEnglishPrefix: englishPrefix,
      plateArabicLetter: '',
      plateGovernorate: '',
      vehicleNumber: normalizeVehicleNumber(`${englishPrefix}${core}`),
      governorate: '',
    };
  }

  const arabicInfo = extractArabicLetterAndGovernorate(compact);
  const arabicLetter = arabicInfo.arabicLetter || normalizeArabicLetter(compact);
  const governorate = arabicInfo.governorate || '';

  if (arabicLetter && core) {
    return {
      plateNumberCore: core,
      plateEnglishPrefix: '',
      plateArabicLetter: arabicLetter,
      plateGovernorate: governorate,
      vehicleNumber: normalizeVehicleNumber(`${arabicLetter}${core}`),
      governorate,
    };
  }

  return {
    plateNumberCore: core,
    plateEnglishPrefix: '',
    plateArabicLetter: arabicLetter,
    plateGovernorate: governorate,
    vehicleNumber: core ? normalizeVehicleNumber(core) : '',
    governorate,
  };
}

function extractVehicleDataFromRawText(rawText = '') {
  const combinedPlateValue =
    extractLabeledValueFromRawText(rawText, [
      'رقم العجلة مع الحرف والعائدية',
      'رقم العجله مع الحرف والعائديه',
      'رقم العجلة والعائدية',
      'رقم العجله والعائديه',
    ]) || '';

  if (combinedPlateValue) {
    const parsedCombined = parseCombinedPlateValue(combinedPlateValue);
    if (
      parsedCombined.vehicleNumber ||
      parsedCombined.plateEnglishPrefix ||
      parsedCombined.plateArabicLetter
    ) {
      return parsedCombined;
    }
  }

  const coreOnly =
    extractLabeledValueFromRawText(rawText, [
      'رقم العجلة',
      'رقم العجله',
      'رقم المركبة',
      'رقم المركبه',
    ]) || '';

  const prefixOnly =
    extractLabeledValueFromRawText(rawText, [
      'العائدية',
      'العائديه',
      'رقم العائدية',
      'رقم العائديه',
    ]) || '';

  const governorateField =
    extractLabeledValueFromRawText(rawText, ['المحافظة', 'المحافظه']) || '';

  const coreDigits = extractCoreDigits(coreOnly);

  const parsedPrefix = parseCombinedPlateValue(prefixOnly);
  const parsedGovernorateField = parseCombinedPlateValue(governorateField);

  if (parsedPrefix.plateEnglishPrefix && coreDigits) {
    return {
      plateNumberCore: coreDigits,
      plateEnglishPrefix: parsedPrefix.plateEnglishPrefix,
      plateArabicLetter: '',
      plateGovernorate: '',
      vehicleNumber: normalizeVehicleNumber(
        `${parsedPrefix.plateEnglishPrefix}${coreDigits}`
      ),
      governorate: '',
    };
  }

  if (
    parsedGovernorateField.plateArabicLetter &&
    parsedGovernorateField.plateGovernorate &&
    coreDigits
  ) {
    return {
      plateNumberCore: coreDigits,
      plateEnglishPrefix: '',
      plateArabicLetter: parsedGovernorateField.plateArabicLetter,
      plateGovernorate: parsedGovernorateField.plateGovernorate,
      vehicleNumber: normalizeVehicleNumber(
        `${parsedGovernorateField.plateArabicLetter}${coreDigits}`
      ),
      governorate: parsedGovernorateField.plateGovernorate,
    };
  }

  return {
    plateNumberCore:
      coreDigits ||
      parsedPrefix.plateNumberCore ||
      parsedGovernorateField.plateNumberCore ||
      '',
    plateEnglishPrefix: parsedPrefix.plateEnglishPrefix || '',
    plateArabicLetter: parsedGovernorateField.plateArabicLetter || '',
    plateGovernorate: parsedGovernorateField.plateGovernorate || '',
    vehicleNumber:
      parsedPrefix.vehicleNumber ||
      parsedGovernorateField.vehicleNumber ||
      (coreDigits ? normalizeVehicleNumber(coreDigits) : ''),
    governorate:
      parsedPrefix.governorate || parsedGovernorateField.governorate || '',
  };
}

function detectEnglishPrefixFromData(data = {}) {
  const candidates = [
    data.plateEnglishPrefix,
    data.plateGovernorate,
    data.vehicleNumber,
  ];

  for (const candidate of candidates) {
    const prefix = normalizeEnglishPrefix(extractEnglishPrefixToken(candidate));
    if (prefix) return prefix;
  }

  const fromRaw = extractVehicleDataFromRawText(data.rawText || '');
  if (fromRaw.plateEnglishPrefix) return fromRaw.plateEnglishPrefix;

  return '';
}

function parseVehiclePlate(rawPlate = '') {
  const original = cleanValue(toWesternDigits(rawPlate));
  if (!original) {
    return {
      original: '',
      vehicleNumber: '',
      governorate: '',
    };
  }

  let value = original
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = normalizeArabic(value);

  let matchedGovernorate = '';
  for (const gov of knownGovernorates) {
    if (
      normalized === gov ||
      normalized.includes(` ${gov} `) ||
      normalized.startsWith(`${gov} `) ||
      normalized.endsWith(` ${gov}`) ||
      normalized.includes(`/${gov}`) ||
      normalized.includes(`${gov}/`)
    ) {
      matchedGovernorate = governorateMap[gov] || gov;
      break;
    }
  }

  const compact = value.replace(/[\s\-\/]+/g, '').toUpperCase();

  const compactEnglishFirst = compact.match(
    /^(\d{1,3}[A-Z]{1,3}|[A-Z]{1,3}\d{1,3})(\d{3,8})$/
  );
  if (compactEnglishFirst) {
    return {
      original,
      vehicleNumber: `${compactEnglishFirst[1]}${compactEnglishFirst[2]}`,
      governorate: '',
    };
  }

  const compactEnglishLast = compact.match(
    /^(\d{3,8})(\d{1,3}[A-Z]{1,3}|[A-Z]{1,3}\d{1,3})$/
  );
  if (compactEnglishLast) {
    return {
      original,
      vehicleNumber: `${compactEnglishLast[2]}${compactEnglishLast[1]}`,
      governorate: '',
    };
  }

  const valueWithoutGov = removeGovernorateWords(value, matchedGovernorate);
  const parts = valueWithoutGov.split(/\s+/).filter(Boolean);

  let englishPrefix = '';
  let vehicleDigits = '';

  for (let i = 0; i < parts.length; i++) {
    const token = parts[i].toUpperCase();

    if (
      !englishPrefix &&
      (/^\d{1,3}[A-Z]{1,3}$/.test(token) || /^[A-Z]{1,3}\d{1,3}$/.test(token))
    ) {
      englishPrefix = token;
      continue;
    }

    if (
      !englishPrefix &&
      i + 1 < parts.length &&
      /^\d{1,3}$/.test(parts[i]) &&
      /^[A-Z]{1,3}$/i.test(parts[i + 1])
    ) {
      englishPrefix = `${parts[i]}${parts[i + 1].toUpperCase()}`;
      i += 1;
      continue;
    }

    if (
      !englishPrefix &&
      i + 1 < parts.length &&
      /^[A-Z]{1,3}$/i.test(parts[i]) &&
      /^\d{1,3}$/.test(parts[i + 1])
    ) {
      englishPrefix = `${parts[i].toUpperCase()}${parts[i + 1]}`;
      i += 1;
      continue;
    }

    if (!vehicleDigits && /^\d{3,8}$/.test(token)) {
      vehicleDigits = token;
    }
  }

  if (englishPrefix && vehicleDigits) {
    return {
      original,
      vehicleNumber: `${englishPrefix}${vehicleDigits}`,
      governorate: '',
    };
  }

  let arabicLetter = '';
  let numberPart = '';

  for (const part of parts) {
    if (!arabicLetter && /^[\u0621-\u064A]$/.test(part)) {
      arabicLetter = part;
      continue;
    }

    if (!arabicLetter && /^[\u0621-\u064A]\d{3,8}$/.test(part)) {
      return {
        original,
        vehicleNumber: normalizeVehicleNumber(part),
        governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
      };
    }

    if (!numberPart && /^\d{3,8}$/.test(part)) {
      numberPart = part;
    }
  }

  if (arabicLetter && numberPart) {
    return {
      original,
      vehicleNumber: normalizeVehicleNumber(`${arabicLetter}${numberPart}`),
      governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
    };
  }

  const compactArabicFirst = compact.match(/^([\u0621-\u064A])(\d{3,8})$/);
  if (compactArabicFirst) {
    return {
      original,
      vehicleNumber: normalizeVehicleNumber(
        `${compactArabicFirst[1]}${compactArabicFirst[2]}`
      ),
      governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
    };
  }

  const compactLatinFirst = compact.match(/^([A-Z])(\d{3,8})$/i);
  if (compactLatinFirst) {
    const arabicLetter = normalizeArabicLetter(compactLatinFirst[1]);
    return {
      original,
      vehicleNumber: normalizeVehicleNumber(`${arabicLetter}${compactLatinFirst[2]}`),
      governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
    };
  }

  const compactArabicLast = compact.match(/^(\d{3,8})([\u0621-\u064A])$/);
  if (compactArabicLast) {
    return {
      original,
      vehicleNumber: normalizeVehicleNumber(
        `${compactArabicLast[2]}${compactArabicLast[1]}`
      ),
      governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
    };
  }

  const compactLatinLast = compact.match(/^(\d{3,8})([A-Z])$/i);
  if (compactLatinLast) {
    const arabicLetter = normalizeArabicLetter(compactLatinLast[2]);
    return {
      original,
      vehicleNumber: normalizeVehicleNumber(`${arabicLetter}${compactLatinLast[1]}`),
      governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
    };
  }

  return {
    original,
    vehicleNumber: compact || normalizeVehicleNumber(original),
    governorate: normalizeGovernorateForDropdown(matchedGovernorate || ''),
  };
}

function buildVehicleIdentity(data = {}) {
  const rawVehicle = extractVehicleDataFromRawText(data.rawText || '');

  if (rawVehicle.plateEnglishPrefix && rawVehicle.plateNumberCore) {
    return {
      vehicleNumber: normalizeVehicleNumber(
        `${rawVehicle.plateEnglishPrefix}${rawVehicle.plateNumberCore}`
      ),
      governorate: '',
    };
  }

  if (rawVehicle.plateArabicLetter && rawVehicle.plateNumberCore) {
    return {
      vehicleNumber: normalizeVehicleNumber(
        `${rawVehicle.plateArabicLetter}${rawVehicle.plateNumberCore}`
      ),
      governorate: normalizeGovernorateForDropdown(
        rawVehicle.plateGovernorate || rawVehicle.governorate || ''
      ),
    };
  }

  const coreNumber =
    extractCoreDigits(data.plateNumberCore || '') ||
    extractCoreDigits(data.vehicleNumber || '') ||
    rawVehicle.plateNumberCore ||
    '';

  const englishPrefix =
    normalizeEnglishPrefix(data.plateEnglishPrefix || '') ||
    detectEnglishPrefixFromData(data) ||
    rawVehicle.plateEnglishPrefix ||
    '';

  if (englishPrefix && coreNumber) {
    return {
      vehicleNumber: normalizeVehicleNumber(`${englishPrefix}${coreNumber}`),
      governorate: '',
    };
  }

  let governorate =
    normalizeGovernorateForDropdown(data.plateGovernorate || '') ||
    rawVehicle.plateGovernorate ||
    '';

  let arabicLetter =
    normalizeArabicLetter(data.plateArabicLetter || '') ||
    rawVehicle.plateArabicLetter ||
    '';

  if (!governorate || !arabicLetter) {
    const extracted = extractArabicLetterAndGovernorate(
      `${data.plateArabicLetter || ''} ${data.plateGovernorate || ''} ${data.vehicleNumber || ''} ${data.rawText || ''}`
    );

    if (!arabicLetter) arabicLetter = extracted.arabicLetter;
    if (!governorate) governorate = extracted.governorate;
  }

  if (arabicLetter && coreNumber) {
    return {
      vehicleNumber: normalizeVehicleNumber(`${arabicLetter}${coreNumber}`),
      governorate: governorate || '',
    };
  }

  if (rawVehicle.vehicleNumber) {
    return {
      vehicleNumber: normalizeVehicleNumber(rawVehicle.vehicleNumber),
      governorate: normalizeGovernorateForDropdown(rawVehicle.governorate || ''),
    };
  }

  const parsed = parseVehiclePlate(
    `${data.vehicleNumber || ''} ${data.plateGovernorate || ''} ${data.plateArabicLetter || ''}`
  );

  return {
    vehicleNumber:
      parsed.vehicleNumber ||
      (coreNumber ? normalizeVehicleNumber(coreNumber) : ''),
    governorate: normalizeGovernorateForDropdown(
      parsed.governorate || governorate || ''
    ),
  };
}

async function resolveVehicleOwnerByName(name) {
  if (!name || !name.trim()) return null;

  const found = await VehicleOwner.findOne({
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
  });

  return found || null;
}

function normalizeVehicleTypeNameValue(value = '') {
  const cleaned = cleanValue(value);
  if (!cleaned) return '';

  const key = normalizeTextKey(cleaned).replace(/\s+/g, '');

  const aliases = {
    تويوتا: 'تويوتا',
    toyota: 'تويوتا',

    نيسان: 'نيسان',
    nissan: 'نيسان',

    مرسيدس: 'مارسيدس',
    مرسدس: 'مارسيدس',
    مرسيديس: 'مارسيدس',
    مارسيدس: 'مارسيدس',
    mercedes: 'مارسيدس',
    mercedesbenz: 'مارسيدس',
    benz: 'مارسيدس',

    سكانيا: 'سكانيا',
    سكانية: 'سكانيا',
    سكانبه: 'سكانيا',
    سكانيه: 'سكانيا',
    سكانياه: 'سكانيا',
    اسكانيا: 'سكانيا',
    scania: 'سكانيا',

    مان: 'مان',
    man: 'مان',

    فولفو: 'فولفو',
    volvo: 'فولفو',

    ايسوزو: 'إيسوزو',
    اسوزو: 'إيسوزو',
    ايزوزو: 'إيسوزو',
    isuzu: 'إيسوزو',

    هيونداي: 'هيونداي',
    hyundai: 'هيونداي',

    كيا: 'كيا',
    kia: 'كيا',

    فورد: 'فورد',
    ford: 'فورد',

    شيفروليه: 'شيفروليه',
    شفروليه: 'شيفروليه',
    chevrolet: 'شيفروليه',

    iveco: 'إيفيكو',
    ايفيكو: 'إيفيكو',

    daf: 'داف',
    داف: 'داف',

    renault: 'رينو',
    رينو: 'رينو',

    mitsubishi: 'ميتسوبيشي',
    ميتسوبيشي: 'ميتسوبيشي',

    hino: 'هينو',
    هينو: 'هينو',

    mazda: 'مازدا',
    مازدا: 'مازدا',

    suzuki: 'سوزوكي',
    سوزوكي: 'سوزوكي',

    lexus: 'لكزس',
    لكزس: 'لكزس',

    bmw: 'بي ام دبليو',
    بيامدبليو: 'بي ام دبليو',

    audi: 'أودي',
    اودي: 'أودي',

    honda: 'هوندا',
    هوندا: 'هوندا',

    jeep: 'جيب',
    جيب: 'جيب',

    gmc: 'جي ام سي',
    جيامسي: 'جي ام سي',
  };

  return aliases[key] || cleaned;
}

async function resolveVehicleTypeByName(name) {
  if (!name || !name.trim()) return null;

  const cleanName = normalizeVehicleTypeNameValue(name);
  if (!cleanName) return null;

  const nameKey = normalizeTextKey(cleanName);

  const found = await VehicleType.findOneAndUpdate(
    { nameKey },
    {
      $setOnInsert: {
        name: cleanName,
        nameKey,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  return found || null;
}

function normalizeDateValue(value = '') {
  const raw = safeString(value);
  if (!raw) return '';

  const western = toWesternDigits(raw)
    .replace(/[.]/g, '/')
    .replace(/\s+/g, '')
    .replace(/[^\d/-]/g, '');

  const ymd = western.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  const dmy = western.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  return '';
}

function normalizeNationalIdValue(value = '') {
  const digits = toWesternDigits(String(value)).replace(/\D/g, '');
  return digits.length === 12 ? digits : '';
}

function collectAll12DigitCandidates(rawText = '') {
  const text = toWesternDigits(String(rawText || ''));
  return text.match(/\d{12}/g) || [];
}

function extractNationalIdFromRawText(rawText = '') {
  const original = String(rawText || '');
  const text = normalizeArabic(toWesternDigits(original));

  const labelPatterns = [
    'رقم البطاقه الوطنيه',
    'رقم البطاقة الوطنية',
    'البطاقه الوطنيه',
    'البطاقة الوطنية',
    'رقم الوطنيه',
    'رقم الوطنية',
    'رقم الجنسيه',
    'رقم الجنسية',
    'رقم الجنسيه الموحده',
    'رقم الجنسية الموحدة',
    'رقم الجنسية / او البطاقة الموحدة',
    'رقم الجنسية / أو البطاقة الموحدة',
    'رقم الجنسيه / او البطاقه الموحده',
    'الجنسيه',
    'الجنسية',
    'رقم هويه الاحوال المدنيه',
    'رقم هوية الاحوال المدنية',
  ];

  const lines = original
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = normalizeArabic(toWesternDigits(lines[i]));

    for (const label of labelPatterns) {
      const labelNorm = normalizeArabic(label);

      if (normalizedLine.includes(labelNorm)) {
        const sameLineDigits = toWesternDigits(lines[i]).replace(/\D/g, '');
        if (sameLineDigits.length === 12) return sameLineDigits;

        const candidates = [
          toWesternDigits(lines[i + 1] || '').replace(/\D/g, ''),
          toWesternDigits(lines[i + 2] || '').replace(/\D/g, ''),
          toWesternDigits(lines[i - 1] || '').replace(/\D/g, ''),
        ];

        for (const candidate of candidates) {
          if (candidate.length === 12) return candidate;
        }

        const joinedWindow = toWesternDigits(
          `${lines[i] || ''} ${lines[i + 1] || ''} ${lines[i + 2] || ''}`
        ).replace(/\D/g, '');
        if (joinedWindow.length >= 12) {
          const direct = joinedWindow.match(/\d{12}/);
          if (direct) return direct[0];
        }
      }
    }
  }

  const patterns = [
    /رقم\s*(?:البطاقه\s*الوطنيه|البطاقة\s*الوطنية|الوطنيه|الوطنية|رقم\s*الوطنية|الجنسيه|الجنسية|رقم\s*الجنسيه|رقم\s*الجنسية|رقم\s*الجنسيه\s*الموحده|رقم\s*الجنسية\s*الموحدة)\s*[:：\-]?\s*([\d\s-]{12,25})/i,
    /(?:رقم\s*الجنسية\s*\/\s*او\s*البطاقة\s*الموحدة|رقم\s*الجنسية\s*\/\s*أو\s*البطاقة\s*الموحدة|رقم\s*الجنسيه\s*\/\s*او\s*البطاقه\s*الموحده)\s*[:：\-]?\s*([\d\s-]{12,25})/i,
    /(?:البطاقه\s*الوطنيه|البطاقة\s*الوطنية|رقم\s*الجنسيه|رقم\s*الجنسية|رقم\s*الجنسيه\s*الموحده|رقم\s*الجنسية\s*الموحدة|الجنسيه|الجنسية)\s*[:：\-]?\s*([\d\s-]{12,25})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const digits = toWesternDigits(match[1]).replace(/\D/g, '');
      if (digits.length === 12) return digits;
      const direct = digits.match(/\d{12}/);
      if (direct) return direct[0];
    }
  }

  const byLabelValue = extractLabeledValueFromRawText(original, [
    'رقم الجنسية / او البطاقة الموحدة',
    'رقم الجنسية / أو البطاقة الموحدة',
    'رقم الجنسيه / او البطاقه الموحده',
    'رقم الجنسية الموحدة',
    'رقم الجنسيه الموحده',
    'رقم الجنسية',
    'رقم الجنسيه',
    'رقم البطاقة الوطنية',
    'رقم البطاقه الوطنيه',
    'البطاقة الوطنية',
    'البطاقه الوطنيه',
  ]);

  const labelDigits = toWesternDigits(byLabelValue || '').replace(/\D/g, '');
  if (labelDigits.length === 12) return labelDigits;
  const embedded = labelDigits.match(/\d{12}/);
  if (embedded) return embedded[0];

  const all12 = collectAll12DigitCandidates(original);
  if (all12.length === 1) return all12[0];

  return '';
}

function extractVehicleTypeFromRawText(rawText = '') {
  const value = extractLabeledValueFromRawText(rawText, [
    'ماركة المركبة',
    'ماركة العجلة',
    'الماركة',
    'ماركة',
    'نوع العجلة',
    'نوع المركبة',
    'نوع المركبه',
  ]);

  return normalizeVehicleTypeNameValue(value);
}

function pickOwnerName(input = {}) {
  const ownerName = cleanValue(safeString(input.ownerName));
  const holderName = cleanValue(safeString(input.holderName));
  return ownerName || holderName || '';
}

function countKeywordHits(text = '') {
  const normalized = normalizeArabic(text);
  const keywords = [
    'رقم العجله',
    'رقم المركبه',
    'رقم العجله والعائديه',
    'رقم العجله مع الحرف والعائديه',
    'المحافظه',
    'العائديه',
    'نوع العجله',
    'نوع المركبه',
    'اسم المالك',
    'اسم المالك في السنويه',
    'اسم الحائز',
    'اسم الام',
    'اسم الام الثلاثي',
    'رقم الجنسيه',
    'رقم الجنسيه الموحده',
    'البطاقه الوطنيه',
    'تاريخ انتهاء السنويه',
    'تاريخ نفاذ السنويه',
  ];

  return keywords.reduce((count, keyword) => {
    return count + (normalized.includes(keyword) ? 1 : 0);
  }, 0);
}

function evaluateRawTextQuality(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) {
    return {
      score: 0,
      lineCount: 0,
      digitGroups: 0,
      keywordHits: 0,
      tooWeak: true,
    };
  }

  const normalized = normalizeArabic(text);
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const digitGroups = (toWesternDigits(text).match(/\d{2,}/g) || []).length;
  const keywordHits = countKeywordHits(text);

  let score = 0;
  score += Math.min(lines.length, 16);
  score += Math.min(digitGroups, 14);
  score += keywordHits * 3;

  if (normalized.includes('نافذه المعلومات للصهاريج والسائقين')) score += 2;
  if (normalized.includes('بيانات السائق والمركبه')) score += 2;
  if (normalized.includes('رقم العجله')) score += 4;
  if (normalized.includes('اسم الام')) score += 4;
  if (normalized.includes('رقم الجنسيه')) score += 5;
  if (normalized.includes('المحافظه')) score += 3;
  if (normalized.includes('العائديه')) score += 3;

  const tooWeak =
    text.length < 60 ||
    lines.length < 4 ||
    (digitGroups < 3 && keywordHits < 2);

  return {
    score,
    lineCount: lines.length,
    digitGroups,
    keywordHits,
    tooWeak,
  };
}

function sanitizeExtractedData(input = {}) {
  const driverName =
    buildDriverNameFromParts(input) ||
    extractLabeledValueFromRawText(input.rawText, [
      'الاسم الرباعي واللقب',
      'اسم السائق',
    ]) ||
    '';

  const motherName = pickBestMotherName(input);
  const builtVehicle = buildVehicleIdentity(input);

  const normalizedNationalId =
    normalizeNationalIdValue(input.nationalId) ||
    extractNationalIdFromRawText(input.rawText);

  const normalizedVehicleType =
    normalizeVehicleTypeNameValue(input.vehicleTypeName) ||
    normalizeVehicleTypeNameValue(
      extractLabeledValueFromRawText(input.rawText, [
        'نوع العجلة',
        'نوع المركبة',
        'نوع المركبه',
        'ماركة المركبة',
        'ماركة العجلة',
        'الماركة',
        'ماركة',
      ])
    ) ||
    extractVehicleTypeFromRawText(input.rawText);

  const normalizedOwnerName =
    pickOwnerName(input) ||
    extractLabeledValueFromRawText(input.rawText, [
      'اسم المالك في السنوية',
      'اسم المالك بالسنوية',
      'اسم المالك',
      'المالك',
    ]) ||
    extractLabeledValueFromRawText(input.rawText, ['اسم الحائز', 'الحائز']);

  const normalizedAddress =
    cleanValue(safeString(input.address)) ||
    extractLabeledValueFromRawText(input.rawText, [
      'العنوان / المحافظه / المنطقه / اقرب نقطه داله',
      'العنوان / المحافظة / المنطقة / أقرب نقطة دالة',
      'عنوان السكن',
      'العنوان',
      'اقرب نقطة دالة',
      'أقرب نقطة دالة',
    ]) ||
    '';

  return {
    driverName: cleanValue(driverName),
    motherName: cleanValue(motherName),
    birthDate: normalizeDateValue(input.birthDate),
    nationalId: normalizedNationalId,
    address: normalizedAddress,
    vehicleNumber: cleanValue(builtVehicle.vehicleNumber),
    governorate: cleanValue(builtVehicle.governorate),
    vehicleTypeName: normalizedVehicleType,
    ownerName: cleanValue(normalizedOwnerName),
    annualExpiry: normalizeDateValue(input.annualExpiry),
    rawText: safeString(input.rawText),
  };
}

function scoreExtractedData(data = {}) {
  let score = 0;

  if (data.driverName) score += 4;
  if (data.motherName) score += 3;
  if (data.birthDate) score += 2;
  if (data.nationalId && String(data.nationalId).length === 12) score += 6;
  if (data.address) score += 2;
  if (data.vehicleNumber) score += 6;
  if (data.governorate) score += 2;
  if (data.vehicleTypeName) score += 2;
  if (data.ownerName) score += 2;
  if (data.annualExpiry) score += 2;

  const quality = evaluateRawTextQuality(data.rawText);
  score += Math.min(quality.score, 20);

  return score;
}

function isGoodEnoughExtract(data = {}) {
  const quality = evaluateRawTextQuality(data.rawText);

  return !!(
    !quality.tooWeak &&
    (data.vehicleNumber ||
      data.driverName ||
      (data.nationalId && String(data.nationalId).length === 12) ||
      (data.vehicleTypeName && data.ownerName))
  );
}

function tryParseJson(content = '') {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function groqVisionToRawText(dataUrl, attempt = 1) {
  const extra =
    attempt === 1
      ? ''
      : `
- مهم جداً: لا تكتفِ بعنوان الشاشة أو عنوان النموذج.
- إذا كانت الصورة عبارة عن جدول، اقرأ كل صف كزوج: اسم الحقل + القيمة المقابلة.
- إذا كانت الصورة واجهة برنامج، استخرج أسماء الحقول والقيم داخل الحقول سطراً بسطر.
- لا تفقد الأسطر التي تحتوي الأرقام أو الحروف الإنجليزية أو الحرف العربي مع رقم اللوحة.
- إذا ظهر صف مثل "رقم العجلة مع الحرف والعائدية" فاستخرج القيمة كاملة كما هي.
- إذا ظهر صف مثل "اسم الأم الثلاثي" فاستخرج الاسم كاملًا لا الاسم الأول فقط.
- إذا ظهر رقم هوية مكوّن من 12 رقمًا بالأرقام الهندية فاحتفظ به كما هو في النص.
`;

  const prompt = `
أنت نظام OCR متخصص بالوثائق العراقية وواجهات البرامج العربية.
المطلوب:
- استخرج النص كما يظهر في الصورة بأكبر دقة ممكنة.
- لا تشرح ولا تلخص.
- حافظ على ترتيب الأسطر تقريبياً.
- إذا كانت الصورة جدولاً، فاستخرج كل صف على شكل: اسم الحقل ثم القيمة.
- إذا كانت الصورة تحتوي نموذج برنامج، فاستخرج جميع التسميات والقيم الظاهرة، وليس عنوان الشاشة فقط.
- اقرأ الحروف العربية والإنجليزية والأرقام معًا بدقة، خصوصًا:
  - أرقام الهوية
  - رقم العجلة
  - العائدية الإنجليزية مثل 21K و22L
  - الحرف العربي مع المحافظة مثل و بغداد 15085
  - الأرقام الهندية مثل ١٩٦٧٨٨٤٤٢٧٩٣
- إذا كانت هناك أجزاء غير واضحة فاكتبها كما تراها دون تخمين.
${extra}
- أعد JSON فقط بهذا الشكل:
{
  "rawText": ""
}
`;

  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
  const parsed = tryParseJson(content);
  return safeString(parsed?.rawText);
}

async function groqRawTextToFields(rawText) {
  const prompt = `
أنت خبير في فهم النصوص المستخرجة من الوثائق العراقية.
أعد JSON فقط.

النص:
${rawText}

استخرج الحقول التالية فقط:

{
  "driverFirstName": "",
  "driverFatherName": "",
  "driverGrandfatherName": "",
  "driverFourthName": "",
  "driverSurname": "",

  "motherFirstName": "",
  "motherFatherName": "",
  "motherGrandfatherName": "",
  "motherSurname": "",

  "birthDate": "",
  "nationalId": "",
  "address": "",

  "plateNumberCore": "",
  "plateEnglishPrefix": "",
  "plateArabicLetter": "",
  "plateGovernorate": "",

  "vehicleTypeName": "",
  "ownerName": "",
  "holderName": "",
  "annualExpiry": "",
  "rawText": ""
}

قواعد مهمة:
- اسم السائق إذا كان مقطعاً إلى: الاسم + الأب + الجد + الرابع أو اللقب، ضعه في الحقول المنفصلة المناسبة.
- إذا وجدت "الاسم الرباعي واللقب" أو "اسم السائق" بقيمة كاملة، فحاول تقسيمها إلى الأجزاء المناسبة.
- اسم الأم قد يكون مقطعاً على شكل: اسم الأم + أب الأم + جد الأم، ضعه في الحقول motherFirstName و motherFatherName و motherGrandfatherName متى أمكن.
- إذا ظهر "اسم الأم الثلاثي" أو "اسم الام الثلاثي" فاستخرج الاسم كاملًا، ولا تكتفِ بالاسم الأول فقط.
- إذا ظهر "اسم الزوجة" أو "الزوجة" أو "اسم الزوج" أو "الزوج" فتجاهله تماماً ولا تضعه داخل حقول الأم.
- لا تخلط بين اسم الأم واسم الزوجة أو الزوج.

قواعد اللوحة:
- إذا كان رقم العجلة أو رقم المركبة رقماً فقط مثل 11553 فضعه في plateNumberCore.
- إذا كانت العائدية إنكليزية مثل 21K أو K21 أو 21 K أو K 21 أو 21-K أو K-21 أو 22L فضعها في plateEnglishPrefix فقط.
- إذا كان رقم العجلة = 11553 والعائدية = 21K فالقيمة النهائية لاحقاً يجب أن تصبح 21K11553.
- إذا كانت العائدية الإنكليزية موجودة فلا تضع أي محافظة في plateGovernorate.
- إذا كان الحقل "رقم العجلة والعائدية" أو "رقم العجلة مع الحرف والعائدية" ويحتوي مثل 22L 22213:
  - plateEnglishPrefix = 22L
  - plateNumberCore = 22213
- إذا كان الحقل "رقم العجلة مع الحرف والعائدية" ويحتوي مثل و بغداد 15085 أو و15085 بغداد:
  - plateArabicLetter = و
  - plateGovernorate = بغداد
  - plateNumberCore = 15085
- في حالة العائدية العربية، يكون رقم المركبة النهائي لاحقاً = الحرف العربي + الرقم، وتعود المحافظة إلى governorate.
- plateNumberCore يجب أن يحتوي الرقم الأساسي فقط.

قواعد الهوية:
- nationalId يجب أن يكون 12 رقم فقط إن وجد.
- إذا ظهر الرقم بالأرقام الهندية مثل ١٩٦٧٨٨٤٤٢٧٩٣ فاعتبره نفس الرقم 196788442793.
- إذا كان الرقم مكتوباً تحت أي من:
  "رقم البطاقة الوطنية" أو "البطاقة الوطنية" أو "رقم الوطنية" أو "رقم الجنسية" أو "رقم الجنسية الموحدة" أو "رقم الجنسية / او البطاقة الموحدة" أو "الجنسية" أو "رقم هوية الاحوال المدنية"
  فاستخرجه إلى nationalId.

قواعد الماركة:
- vehicleTypeName المقصود به هنا "ماركة المركبة" وليس تصنيفها.
- إذا وجدت حقول مثل: "ماركة المركبة" أو "ماركة العجلة" أو "الماركة" فاستخرجها إلى vehicleTypeName.
- بعض الواجهات قد تستخدم "نوع المركبة" أو "نوع العجلة" وهي تقصد الماركة.
- إذا ظهرت قراءة OCR قريبة مثل "سكانية" فاعتبرها "سكانيا" متى كان السياق يدل على الماركة.
- لا تضع قيماً تصنيفية مثل: صهريج أو شاحنة داخل vehicleTypeName.

- "اسم الحائز" يستخرج في holderName.
- إذا كان ownerName غير موجود وكان holderName موجوداً فاعتبر ownerName = holderName.
- "اسم المالك في السنوية" أو "اسم المالك بالسنوية" يذهب إلى ownerName.
- العنوان قد يأتي تحت "العنوان" أو "عنوان السكن" أو "العنوان / المحافظة / المنطقة / أقرب نقطة دالة".
- التواريخ بصيغة YYYY-MM-DD إن أمكن.
- إذا لم تعرف قيمة أي حقل فاجعله "".
- لا تشرح، أعد JSON فقط.
`;

  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });

  const content = completion?.choices?.[0]?.message?.content || '';
  const parsed = tryParseJson(content);

  return parsed || {};
}

exports.extractImageData = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        message: 'GROQ_API_KEY غير موجود في ملف البيئة',
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم إرسال صورة' });
    }

    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'الملف المرسل ليس صورة' });
    }

    if (req.file.size > 3 * 1024 * 1024) {
      return res.status(400).json({
        message: 'حجم الصورة كبير جداً، يرجى ضغط الصورة ثم المحاولة مرة أخرى',
      });
    }

    const base64Image = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${base64Image}`;

    let bestResult = { ...EMPTY_EXTRACT };
    let bestScore = -1;
    let bestRawTextQuality = -1;

    for (let i = 1; i <= 3; i++) {
      const rawText = await groqVisionToRawText(dataUrl, i);
      if (!rawText) continue;

      const quality = evaluateRawTextQuality(rawText);

      const parsed = await groqRawTextToFields(rawText);
      const cleaned = sanitizeExtractedData({
        ...parsed,
        rawText: parsed?.rawText || rawText,
      });

      const score = scoreExtractedData(cleaned);

      if (
        score > bestScore ||
        (score === bestScore && quality.score > bestRawTextQuality)
      ) {
        bestScore = score;
        bestRawTextQuality = quality.score;
        bestResult = cleaned;
      }

      if (isGoodEnoughExtract(cleaned)) {
        break;
      }
    }

    if (
      !bestResult.rawText &&
      !bestResult.driverName &&
      !bestResult.vehicleNumber &&
      !bestResult.nationalId
    ) {
      return res.json({
        success: false,
        message: 'تمت قراءة الصورة لكن لم يتم استخراج نص واضح',
        data: { ...EMPTY_EXTRACT },
      });
    }

    const finalQuality = evaluateRawTextQuality(bestResult.rawText);
    if (
      finalQuality.tooWeak &&
      !bestResult.vehicleNumber &&
      !bestResult.driverName &&
      !bestResult.nationalId
    ) {
      return res.json({
        success: false,
        message:
          'تم استخراج عنوان أو نص جزئي فقط من الصورة، يرجى استخدام صورة أوضح أو إعادة المحاولة',
        data: { ...EMPTY_EXTRACT },
      });
    }

    return res.json({
      success: true,
      data: bestResult,
    });
  } catch (error) {
    console.error('Groq Extract Error:', error);

    if (error?.status === 429 || error?.statusCode === 429) {
      return res.json({
        success: false,
        message:
          'تم تجاوز حد الطلبات لـ Groq، يرجى المحاولة لاحقاً أو الإدخال يدوياً.',
        data: { ...EMPTY_EXTRACT },
      });
    }

    return res.status(500).json({
      message: 'خطأ في معالجة الصورة',
      error: error.message,
    });
  }
};

exports.saveImageData = async (req, res) => {
  try {
    const {
      driverName = '',
      motherName = '',
      birthDate = '',
      nationalId = '',
      address = '',
      vehicleNumber = '',
      governorate = '',
      vehicleTypeName = '',
      ownerName = '',
      annualExpiry = '',
      rawText = '',
    } = req.body || {};

    if (!driverName && !vehicleNumber) {
      return res.status(400).json({
        message: 'يجب توفير اسم السائق أو رقم المركبة على الأقل',
      });
    }

    let driverDoc = null;
    let vehicleDoc = null;

    const cleanDriverName = cleanValue(driverName);
    const cleanMotherName = cleanValue(motherName);
    const cleanNationalId = normalizeNationalIdValue(nationalId);
    const cleanAddress = cleanValue(address);

    const parsedBirthDate = birthDate ? new Date(birthDate) : null;

    if (cleanDriverName) {
      const driverQuery = cleanNationalId
        ? { nationalId: cleanNationalId }
        : {
            name: cleanDriverName,
            motherName: cleanMotherName || '',
          };

      driverDoc = await Driver.findOneAndUpdate(
        driverQuery,
        {
          name: cleanDriverName,
          motherName: cleanMotherName || '',
          birthDate:
            parsedBirthDate && !isNaN(parsedBirthDate)
              ? parsedBirthDate
              : null,
          nationalId: cleanNationalId || '',
          address: cleanAddress || '',
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );
    }

    if (vehicleNumber) {
      const parsedPlate = parseVehiclePlate(vehicleNumber);
      const cleanVehicleNumber =
        parsedPlate.vehicleNumber || normalizeVehicleNumber(vehicleNumber);

      const cleanGovernorate = normalizeGovernorateForDropdown(
        governorate || parsedPlate.governorate || ''
      );

      const vehicleNumberKey = normalizeTextKey(cleanVehicleNumber);
      const governorateKey = normalizeTextKey(cleanGovernorate);

      let ownerId = null;
      if (ownerName && ownerName.trim()) {
        const owner = await resolveVehicleOwnerByName(ownerName);
        if (owner) ownerId = owner._id;
      }

      let vehicleTypeId = null;
      if (vehicleTypeName && vehicleTypeName.trim()) {
        const vtype = await resolveVehicleTypeByName(vehicleTypeName);
        if (vtype) vehicleTypeId = vtype._id;
      }

      const parsedAnnual = annualExpiry ? new Date(annualExpiry) : null;

      vehicleDoc = await Vehicle.findOneAndUpdate(
        {
          vehicleNumberKey,
          governorateKey,
        },
        {
          vehicleNumber: cleanVehicleNumber,
          governorate: cleanGovernorate,
          vehicleNumberKey,
          governorateKey,
          ...(driverDoc ? { driver: driverDoc._id } : {}),
          ...(ownerId ? { owner: ownerId } : {}),
          ...(vehicleTypeId ? { vehicleType: vehicleTypeId } : {}),
          annualExpiry:
            parsedAnnual && !isNaN(parsedAnnual) ? parsedAnnual : null,
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );
    }

    return res.json({
      success: true,
      message: 'تم حفظ البيانات بنجاح',
      data: {
        driverId: driverDoc?._id || null,
        vehicleId: vehicleDoc?._id || null,
        driverName: cleanDriverName,
        motherName: cleanMotherName,
        birthDate: driverDoc?.birthDate || null,
        nationalId: driverDoc?.nationalId || '',
        address: driverDoc?.address || '',
        vehicleNumber: vehicleDoc?.vehicleNumber || '',
        governorate: vehicleDoc?.governorate || '',
        annualExpiry: vehicleDoc?.annualExpiry || null,
        rawText: rawText || '',
      },
    });
  } catch (error) {
    console.error('saveImageData error:', error);
    return res.status(500).json({
      message: 'فشل في حفظ البيانات',
      error: error.message,
    });
  }
};
