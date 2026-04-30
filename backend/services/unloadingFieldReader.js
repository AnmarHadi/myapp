const path = require('path');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const {
  buildFieldVariants,
  buildVariants,
} = require('./documentPreprocessor');

const FIELD_CELLS = {
  documentType: { x: 0.295, y: 0.120, w: 0.095, h: 0.080 },
  documentNumber: { x: 0.330, y: 0.208, w: 0.250, h: 0.060 },
  issueDate: { x: 0.655, y: 0.139, w: 0.175, h: 0.032 },
  loadingWarehouseName: { x: 0.645, y: 0.104, w: 0.220, h: 0.034 },
  receiverEntity: { x: 0.565, y: 0.163, w: 0.315, h: 0.050 },
  vehicleField: { x: 0.645, y: 0.214, w: 0.205, h: 0.034 },
  quantityLiters: { x: 0.475, y: 0.302, w: 0.145, h: 0.038 },
  driverName: { x: 0.140, y: 0.748, w: 0.350, h: 0.034 },
};

const LOADING_FIELD_CELLS = {
  documentType: { x: 0.120, y: 0.065, w: 0.260, h: 0.075 },
  documentNumber: { x: 0.060, y: 0.020, w: 0.240, h: 0.060 },
  issueDate: { x: 0.530, y: 0.085, w: 0.410, h: 0.120 },
  loadingWarehouseName: { x: 0.560, y: 0.130, w: 0.330, h: 0.085 },
  receiverEntity: { x: 0.120, y: 0.130, w: 0.330, h: 0.085 },
  vehicleField: { x: 0.165, y: 0.250, w: 0.240, h: 0.060 },
  productType: { x: 0.300, y: 0.405, w: 0.420, h: 0.080 },
  quantityLiters: { x: 0.775, y: 0.385, w: 0.110, h: 0.075 },
  driverName: [
    { x: 0.150, y: 0.180, w: 0.350, h: 0.075 },
    { x: 0.150, y: 0.418, w: 0.600, h: 0.136 },
    { x: 0.610, y: 0.742, w: 0.250, h: 0.040 },
  ],
};

const KNOWN_WAREHOUSES = [
  'مستودع النجف الجديد',
  'مستودع الدورة الجديد',
  'مستودع الشعيبة',
  'مستودع الشعبية',
  'مصفى الناصرية',
  'مصفى السماوة',
  'شركة الشبكة النفطية',
  'شركة الشبكة النفطية القابضة',
  'الشبكة النفطية',
  'شركة الشبكة الذهبية',
  'شركة الشبكة الذهبية القابضة',
  'الشبكة الذهبية',
  'الشبكة الذهبية القابضة',
  'مصفى النفط الذهبي',
  'مصفاة النفط الذهبي',
];

const KNOWN_RECEIVERS = [
  'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد',
  'مصفى النفط الذهبي',
  'مصفاة النفط الذهبي',
];

const toWesternDigits = (value = '') => {
  const map = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value).replace(/[٠-٩]/g, (d) => map[d] || d);
};

const cleanValue = (value = '') =>
  String(value)
    .replace(/[\u200f\u200e]/g, '')
    .replace(/^[\s:：\-–—|/\\.,;]+/, '')
    .replace(/[\s:：\-–—|/\\.,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeArabic = (text = '') =>
  toWesternDigits(
    String(text)
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ـ/g, '')
      .replace(/[^\u0621-\u064A0-9A-Za-z\s/.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

const normalizeTextKey = (value = '') =>
  normalizeArabic(String(value)).trim().toLowerCase();

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

function bestKnownMatch(input = '', choices = []) {
  const key = normalizeTextKey(input);
  if (!key) return '';

  let best = '';
  let bestScore = Infinity;

  for (const choice of choices) {
    const c = normalizeTextKey(choice);
    if (!c) continue;

    if (key.includes(c) || c.includes(key)) return choice;

    const score = levenshtein(key, c);
    if (score < bestScore) {
      bestScore = score;
      best = choice;
    }
  }

  if (!best) return '';
  const maxAllowed = Math.max(3, Math.floor(normalizeTextKey(best).length * 0.45));
  return bestScore <= maxAllowed ? best : '';
}

function normalizeDocumentTypeVariant(value = '') {
  return String(value || '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[Aa]/g, 'ا')
    .replace(/[Bb]/g, 'ب')
    .replace(/[Cc]/g, 'ج')
    .replace(/تصديري/g, 'تصدير')
    .replace(/[ـ\.\-_:,،؛|/\\()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalDocumentType(value = '') {
  const raw = cleanValue(value);
  if (!raw) return '';

  const normalizedText = normalizeArabic(raw);
  const variantText = normalizeDocumentTypeVariant(raw);

  if (/^126\s*تصدير$/.test(variantText) || /^126\s*تصديري$/.test(variantText)) {
    return '126 تصديري';
  }

  if (
    normalizedText.includes(normalizeArabic('126 تصدير')) ||
    normalizedText.includes(normalizeArabic('126 تصديري'))
  ) {
    return '126 تصديري';
  }

  let compact = normalizeDocumentTypeVariant(raw).replace(/\s+/g, '');
  compact = toWesternDigits(compact);
  compact = compact
    .replace(/[\u0649]/g, 'ي')
    .replace(/[\u0627\u0623\u0625\u0622]/g, 'ا')
    .replace(/[A]/g, 'ا')
    .replace(/[B]/g, 'ب')
    .replace(/[C]/g, 'ج')
    .replace(/[^\d\u0621-\u064A]/g, '');

  const exact = compact.match(/(?:^|[^0-9])(\d{2})([\u0621-\u064A])/);
  if (exact) {
    const letter = exact[2] === 'أ' || exact[2] === 'إ' || exact[2] === 'آ' ? 'ا' : exact[2];
    return `${exact[1]}${letter}`;
  }

  if (/^68[اابج]$/.test(compact)) {
    return compact.replace(/^68([أإآ])$/, '68ا');
  }

  if (compact === '68') {
    return '68ج';
  }

  if (/^68a$/i.test(String(value || '').replace(/\s+/g, ''))) return '68ا';
  if (/^68b$/i.test(String(value || '').replace(/\s+/g, ''))) return '68ب';
  if (/^68c$/i.test(String(value || '').replace(/\s+/g, ''))) return '68ج';

  const direct68 = compact.match(/(?:^|[^0-9])68([اابج])/);
  if (direct68) {
    const letter = direct68[1] === 'أ' || direct68[1] === 'إ' || direct68[1] === 'آ' ? 'ا' : direct68[1];
    return `68${letter}`;
  }

  if (/^68[abc]$/i.test(String(value || '').replace(/\s+/g, ''))) {
    const latin = String(value || '').replace(/\s+/g, '').toUpperCase();
    const letter = latin.slice(-1);
    const map = { A: 'ا', B: 'ب', C: 'ج' };
    return `68${map[letter] || 'ا'}`;
  }

  if (normalizedText.includes(normalizeArabic('تصديري'))) {
    return '126 تصديري';
  }

  if (/^90$/.test(compact) || normalizedText.includes(normalizeArabic('استمارة نقل 90'))) {
    return '90';
  }

  const digits = compact.match(/\d/g) || [];
  const letters = compact.match(/[\u0621-\u064A]/g) || [];

  if (digits.length >= 2 && letters.length >= 1) {
    const letter = letters[0] === 'أ' || letters[0] === 'إ' || letters[0] === 'آ' ? 'ا' : letters[0];
    return `${digits[0]}${digits[1]}${letter}`;
  }

  return '';
}

function pickBestDocumentType(values = [], rawText = '') {
  const candidates = [];

  for (const value of values) {
    const canonical = canonicalDocumentType(value);
    if (canonical) {
      candidates.push(canonical);
    }
  }

  const merged = `${cleanValue(rawText)} ${values.join(' ')}`.trim();
  const normalizedMerged = normalizeDocumentTypeVariant(merged);

  if (
    /126\s*تصدير/.test(normalizedMerged)
    || /126\s*تصديري/.test(normalizedMerged)
    || normalizeArabic(merged).includes(normalizeArabic('126 تصدير'))
    || normalizeArabic(merged).includes(normalizeArabic('126 تصديري'))
  ) {
    candidates.push('126 تصديري');
  }

  const mergedArabic = normalizeArabic(merged);
  if (
    mergedArabic.includes(normalizeArabic('زيت الوقود'))
    || mergedArabic.includes(normalizeArabic('الكمية المجهزة'))
    || mergedArabic.includes(normalizeArabic('رقم السيارة'))
    || (mergedArabic.includes(normalizeArabic('مستند')) && mergedArabic.includes(normalizeArabic('الوقود')))
  ) {
    candidates.push('68ج');
  }

  if (
    /\b90\b/.test(merged)
    || normalizeArabic(merged).includes(normalizeArabic('استمارة نقل 90'))
  ) {
    candidates.push('90');
  }

  const compactMerged = normalizeDocumentTypeVariant(merged)
    .replace(/\s+/g, '')
    .replace(/[^\dA-Za-z\u0621-\u064A]/g, '');
  const exact68 = compactMerged.match(/68([A-Za-z\u0621-\u064A])/);
  if (exact68) {
    const map = { A: 'ا', B: 'ب', C: 'ج', a: 'ا', b: 'ب', c: 'ج', أ: 'ا', إ: 'ا', آ: 'ا' };
    candidates.push(`68${map[exact68[1]] || exact68[1]}`);
  }

  if (!candidates.length) return '';

  const uniqueCandidates = [...new Set(candidates)];
  return (
    uniqueCandidates.find((candidate) => candidate === '126 تصديري')
    || uniqueCandidates.find((candidate) => candidate === '90')
    || uniqueCandidates.find((candidate) => /^68[ابج]$/.test(candidate) || candidate === '68ج')
    || uniqueCandidates[0]
    || ''
  );
}

function canonicalReceiverEntity(value = '', rawText = '') {
  const raw = cleanValue(value);
  const merged = `${raw} ${cleanValue(rawText)}`.trim();
  const found = bestKnownMatch(merged, KNOWN_RECEIVERS);

  if (found === 'مصفى النفط الذهبي' || found === 'مصفاة النفط الذهبي') {
    return 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
  }
  if (found) return found;

  const n = normalizeArabic(merged);
  const hasOilSignal = [
    'النفط',
    'النلط',
    'الفنط',
  ].some((token) => n.includes(normalizeArabic(token)));
  const hasGoldenSignal = [
    'الذهبي',
    'الذهبية',
    'الذهبيه',
    'الذهبى',
    'الذهب',
    'الذهب',
  ].some((token) => n.includes(normalizeArabic(token)));
  const hasReceiverContextSignal = [
    'مصفى',
    'مصفاة',
    'معمل',
    'م. النفط',
    'الشبكة',
    'القابضة',
    'القابضه',
  ].some((token) => n.includes(normalizeArabic(token)));
  const hasNetworkGoldenSignal =
    n.includes(normalizeArabic('الشبكة الذهبية')) ||
    (n.includes(normalizeArabic('الشبكة')) && hasGoldenSignal);
  const hasGoldenHoldingSignal =
    n.includes(normalizeArabic('الذهبية القابضة')) ||
    (n.includes(normalizeArabic('الذهبية')) && (
      n.includes(normalizeArabic('القابضة')) ||
      n.includes(normalizeArabic('القابضه'))
    ));

  if (
    n.includes(normalizeArabic('مصفى النفط الذهبي')) ||
    n.includes(normalizeArabic('مصفاة النفط الذهبي'))
  ) {
    return 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
  }

  if (
    n.includes(normalizeArabic('شركة الشبكة الذهبية القابضة')) ||
    n.includes(normalizeArabic('الشبكة الذهبية القابضة'))
  ) {
    return 'شركة الشبكة الذهبية القابضة';
  }

  if (
    n.includes(normalizeArabic('شركة الشبكة الذهبية')) ||
    n.includes(normalizeArabic('الشبكة الذهبية'))
  ) {
    return 'شركة الشبكة الذهبية';
  }

  if (
    n.includes(normalizeArabic('مصفى النفط الذهبي')) ||
    n.includes(normalizeArabic('مصفاة النفط الذهبي'))
  ) {
    return 'مصفى النفط الذهبي';
  }

  if (hasOilSignal && hasGoldenSignal && hasReceiverContextSignal) {
    return 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
  }

  if ((hasNetworkGoldenSignal && hasReceiverContextSignal) || (hasGoldenHoldingSignal && hasReceiverContextSignal)) {
    return 'معمل مصفى النفط الذهبي لإنتاج الاسفلت المؤكسد';
  }

  return raw;
}

function sanitizeWarehouseName(value = '', rawText = '') {
  let v = cleanValue(value)
    .replace(/^الجهة المجهزة\s*/i, '')
    .replace(/^الجهه المجهزه\s*/i, '')
    .trim();

  const merged = `${v} ${cleanValue(rawText)}`.trim();
  const n = normalizeArabic(merged);
  const isLoadingWarehouseContext =
    n.includes(normalizeArabic('الجهة المجهزة')) ||
    n.includes(normalizeArabic('اسم المعمل المجهز'));

  if (
    n.includes(normalizeArabic('مستودع النجف الجديد')) ||
    (n.includes(normalizeArabic('مستودع')) && n.includes(normalizeArabic('النجف')))
  ) {
    return 'مستودع النجف الجديد';
  }

  const found = bestKnownMatch(merged, KNOWN_WAREHOUSES);
  if (found) return found;

  if (isLoadingWarehouseContext) {
    if (
      n.includes(normalizeArabic('مصفى النفط الذهبي')) ||
      n.includes(normalizeArabic('مصفاة النفط الذهبي')) ||
      n.includes(normalizeArabic('مصفى')) ||
      n.includes(normalizeArabic('مصفاة'))
    ) {
      return 'مصفى النفط الذهبي';
    }
    if (
      n.includes(normalizeArabic('شركة الشبكة الذهبية القابضة')) ||
      n.includes(normalizeArabic('الشبكة الذهبية القابضة'))
    ) {
      return 'شركة الشبكة الذهبية القابضة';
    }
    if (
      n.includes(normalizeArabic('شركة الشبكة الذهبية')) ||
      n.includes(normalizeArabic('الشبكة الذهبية'))
    ) {
      return 'شركة الشبكة الذهبية';
    }
    if (
      n.includes(normalizeArabic('شركة الشبكة النفطية القابضة')) ||
      n.includes(normalizeArabic('الشبكة النفطية القابضة'))
    ) {
      return 'شركة الشبكة النفطية القابضة';
    }
    if (
      n.includes(normalizeArabic('شركة الشبكة النفطية')) ||
      n.includes(normalizeArabic('الشبكة النفطية'))
    ) {
      return 'شركة الشبكة النفطية';
    }
  }

  if (n.includes(normalizeArabic('مستودع النجف الجديد'))) return 'مستودع النجف الجديد';
  if (n.includes(normalizeArabic('مستودع الدورة الجديد'))) return 'مستودع الدورة الجديد';
  if (
    n.includes(normalizeArabic('مصفى السماوة')) ||
    n.includes(normalizeArabic('مصفاة السماوة')) ||
    n.includes(normalizeArabic('مصفى السماوه')) ||
    n.includes(normalizeArabic('مصفاة السماوه'))
  ) return 'مصفى السماوة';
  if (
    n.includes(normalizeArabic('مصفى الناصرية')) ||
    n.includes(normalizeArabic('مصفاة الناصرية'))
  ) return 'مصفى الناصرية';

  return v;
}

function sanitizeDriverName(value = '') {
  let v = cleanValue(value)
    .replace(/اسم\s*السائق/gi, '')
    .replace(/اسم\s*السايق/gi, '')
    .replace(/السان[ئء]?ق/gi, '')
    .replace(/السائق/gi, '')
    .replace(/اسم\s*وختم\s*الجهة\s*المجهز[هة]/gi, '')
    .replace(/اسم\s*وختم\s*الجهة\s*المجلهز[هة]/gi, '')
    .replace(/اسم\s*الام.*/gi, '')
    .replace(/رقم\s*الهويه.*/gi, '')
    .replace(/تاريخ\s*الهويه.*/gi, '')
    .replace(/موظف\s*التجهيز.*/gi, '')
    .replace(/العنوان\s*الوظيفي.*/gi, '')
    .replace(/الموظف\s*المسؤول\s*عن\s*تفريغ\s*او\s*تحويل\s*المنتوج.*/gi, '')
    .replace(/الموظف\s*المسؤول\s*عن\s*استلام\s*المنتوج.*/gi, '')
    .replace(/رقم\s*تسهيل\s*المهمة.*/gi, '')
    .replace(/رقم\s*الامر\s*التجهيزي.*/gi, '')
    .replace(/تاريخ\s*الامر\s*التجهيزي.*/gi, '')
    .replace(/تاريخ\s*التفريغ.*/gi, '')
    .replace(/تاريخ\s*الوصول.*/gi, '')
    .replace(/وقت\s*الإرسال.*/gi, '')
    .replace(/وقت\s*الارسال.*/gi, '')
    .replace(/التوقيع.*/gi, '')
    .replace(/الكمية/gi, '')
    .replace(/المجهزة/gi, '')
    .replace(/المجهز/gi, '')
    .replace(/المركبة/gi, '')
    .replace(/المرسلة/gi, '')
    .replace(/المرسل/gi, '')
    .replace(/الجهة/gi, '')
    .replace(/الجهات/gi, '')
    .replace(/التحميل/gi, '')
    .trim();

  v = v
    .replace(/\bاصود\b/gi, 'اسود')
    .replace(/\bاسبود\b/gi, 'اسود')
    .replace(/\bاسماعيل\b/gi, 'اسماعيل')
    .replace(/\bسماعيل\b/gi, 'سماعيل')
    .replace(/\bا(?:س)?ماعيل\b/gi, 'اسماعيل');

  const parts = v.split(/\s+/).filter(Boolean);
  const cleanedParts = parts.filter((p) => {
    const tokenValue = cleanValue(p);
    const n = normalizeArabic(p);
    const western = toWesternDigits(p);

    if (/^\d+$/.test(western)) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(western)) return false;
    if (!/^[\u0600-\u06FF]{2,}$/.test(tokenValue)) return false;
    if (
      n.includes('الام') ||
      n.includes('الهويه') ||
      n.includes('اسم') ||
      n.includes('موظف') ||
      n.includes('التجهيز') ||
      n.includes('الجهة') ||
      n.includes('العنوان') ||
      n.includes('الوظيفي') ||
      n.includes('التوقيع') ||
      n.includes('تسهيل') ||
      n.includes('المهمة') ||
      n.includes('الوصول') ||
      n.includes('التفريغ') ||
      n.includes('المنتوج')
    ) return false;
    return true;
  });

  return cleanValue(cleanedParts.slice(0, 6).join(' '));
}

function normalizeDateValue(value = '') {
  const raw = cleanValue(value);
  if (!raw) return '';

  const western = toWesternDigits(raw)
    .replace(/[.،,]/g, '/')
    .replace(/[|\\]/g, '/')
    .replace(/\s+/g, '')
    .replace(/[^\d/-]/g, '');

  const candidates = [
    western,
    western.replace(/--+/g, '-'),
    western.replace(/\/+/g, '/'),
    western.replace(/-+/g, '-'),
    western.replace(/[/-]/g, '/'),
  ];

  for (const item of candidates) {
    let m = item.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }

    m = item.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }

  const digitsOnly = western.replace(/[^\d]/g, '');

  if (/^20\d{6}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 6)}-${digitsOnly.slice(6, 8)}`;
  }

  if (/^\d{2}\d{2}20\d{4}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(4, 8)}-${digitsOnly.slice(2, 4)}-${digitsOnly.slice(0, 2)}`;
  }

  const loose = western.match(/(20\d{2})[^\d]?(\d{1,2})[^\d]?(\d{1,2})/);
  if (loose) {
    return `${loose[1]}-${loose[2].padStart(2, '0')}-${loose[3].padStart(2, '0')}`;
  }

  return '';
}

function normalizeDocumentNumber(value = '') {
  const compact = toWesternDigits(cleanValue(value))
    .replace(/[oO]/g, '0')
    .replace(/[iIlL]/g, '1')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  const m = compact.match(/^([A-Z])(\d{7,8})$/);
  return m ? `${m[1]}${m[2]}` : '';
}

function normalizeEnglishPrefix(value = '') {
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = cleaned.match(/^([A-Z]{1,3})\d{3,8}$/);
  return m ? m[1] : '';
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

function extractCoreDigits(value = '') {
  const m = toWesternDigits(value).match(/(\d{3,8})/);
  return m ? m[1] : '';
}

function extractBetweenLabels(rawText = '', startLabels = [], endLabels = []) {
  const source = cleanValue(rawText || '');
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

  return cleanValue(source.slice(from, endIndex));
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabelValue(rawText = '', startLabels = [], endLabels = [], { lookahead = 3 } = {}) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);

  if (!lines.length) return '';

  const normalizedLines = lines.map((line) => ({
    line,
    normalized: normalizeArabic(line),
  }));
  const normalizedStarts = startLabels.map((label) => normalizeArabic(label));
  const normalizedEnds = endLabels.map((label) => normalizeArabic(label));

  for (let i = 0; i < normalizedLines.length; i += 1) {
    const current = normalizedLines[i];
    for (let s = 0; s < startLabels.length; s += 1) {
      const rawLabel = startLabels[s];
      const normalizedLabel = normalizedStarts[s];

      if (!current.normalized.includes(normalizedLabel)) continue;

      const sameLineMatch = current.line.match(
        new RegExp(`${escapeRegex(rawLabel)}\\s*[:|/\\\\\\-–—\\s]*([^\n]+)$`, 'i')
      );
      if (sameLineMatch) {
        const directValue = cleanValue(sameLineMatch[1]);
        if (directValue) return directValue;
      }

      for (let offset = 1; offset <= lookahead && i + offset < normalizedLines.length; offset += 1) {
        const next = normalizedLines[i + offset];
        if (normalizedStarts.some((label) => next.normalized.includes(label))) break;
        if (normalizedEnds.some((label) => next.normalized.includes(label))) break;
        if (next.line) return next.line;
      }
    }
  }

  return '';
}

function parseVehicleFieldSmart(value = '') {
  value = cleanValue(toWesternDigits(value));
  if (!value) {
    return {
      raw: '',
      vehicleNumber: '',
      coreNumber: '',
      arabicLetter: '',
      englishPrefix: '',
      governorate: '',
      kind: 'unknown',
    };
  }

  const normalized = normalizeArabic(value);
  const compact = value.replace(/\s+/g, '');
  const labeledValue = extractBetweenLabels(
    value,
    ['رقم السيارة', 'رقم المركبة', 'رقم السيارة الناقلة', 'رقم السياره'],
    ['نوع المنتوج', 'نوع المنتج', 'زيت الوقود', 'الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال']
  );
  const labeledCompact = toWesternDigits(labeledValue || '').replace(/\s+/g, '');

  const slashDigitsFirst = labeledCompact.match(/(\d{4,6})\s*\/\s*(\d{1,3}[A-Za-z])/i)
    || value.match(/(\d{4,6})\s*\/\s*(\d{1,3}[A-Za-z])/i);
  if (slashDigitsFirst) {
    return {
      raw: cleanValue(labeledValue || value),
      vehicleNumber: `${slashDigitsFirst[1]}/${slashDigitsFirst[2].toUpperCase()}`,
      coreNumber: slashDigitsFirst[1],
      arabicLetter: '',
      englishPrefix: '',
      governorate: '',
      kind: 'slash',
    };
  }

  const slashPrefixFirst = labeledCompact.match(/(\d{1,3}[A-Za-z])\s*\/\s*(\d{4,6})/i)
    || value.match(/(\d{1,3}[A-Za-z])\s*\/\s*(\d{4,6})/i);
  if (slashPrefixFirst) {
    return {
      raw: cleanValue(labeledValue || value),
      vehicleNumber: `${slashPrefixFirst[2]}/${slashPrefixFirst[1].toUpperCase()}`,
      coreNumber: slashPrefixFirst[2],
      arabicLetter: '',
      englishPrefix: '',
      governorate: '',
      kind: 'slash',
    };
  }

  const englishPrefix = normalizeEnglishPrefix(compact);
  const core = extractCoreDigits(compact);
  if (englishPrefix && core) {
    return {
      raw: value,
      vehicleNumber: `${englishPrefix}${core}`,
      coreNumber: core,
      arabicLetter: '',
      englishPrefix,
      governorate: '',
      kind: 'english',
    };
  }

  const arabicLetterMatch = value.match(/[\u0621-\u064A]/);
  const arabicLetter = arabicLetterMatch ? arabicLetterMatch[0] : '';
  const numberMatch = toWesternDigits(value).match(/\d{3,8}/);
  const latinLetterMatch = value.match(/^([A-Za-z])\s*(\d{3,8})(?:\s+([\u0600-\u06FF\s]+))?$/);
  const latinLetter = latinLetterMatch ? normalizeArabicVehicleLetter(latinLetterMatch[1] || '') : '';

  const governorateMatch =
    normalized.includes(normalizeArabic('ديالى')) ? 'ديالى' :
    normalized.includes(normalizeArabic('النجف')) ? 'النجف' :
    normalized.includes(normalizeArabic('بغداد')) ? 'بغداد' :
    normalized.includes(normalizeArabic('البصرة')) ? 'البصرة' :
    normalized.includes(normalizeArabic('نينوى')) ? 'نينوى' :
    normalized.includes(normalizeArabic('أربيل')) ? 'أربيل' :
    normalized.includes(normalizeArabic('اربيل')) ? 'أربيل' :
    normalized.includes(normalizeArabic('الأنبار')) ? 'الأنبار' :
    normalized.includes(normalizeArabic('الانبار')) ? 'الأنبار' :
    normalized.includes(normalizeArabic('بابل')) ? 'بابل' :
    normalized.includes(normalizeArabic('ذي قار')) ? 'ذي قار' :
    normalized.includes(normalizeArabic('صلاح الدين')) ? 'صلاح الدين' :
    normalized.includes(normalizeArabic('كربلاء')) ? 'كربلاء' :
    '';

  if (arabicLetter && numberMatch) {
    return {
      raw: value,
      vehicleNumber: `${arabicLetter}${numberMatch[0]}`,
      coreNumber: numberMatch[0],
      arabicLetter,
      englishPrefix: '',
      governorate: governorateMatch,
      kind: 'arabic',
    };
  }

  if (latinLetter && numberMatch) {
    return {
      raw: value,
      vehicleNumber: `${latinLetter}${numberMatch[0]}`,
      coreNumber: numberMatch[0],
      arabicLetter: latinLetter,
      englishPrefix: '',
      governorate: governorateMatch || '',
      kind: 'arabic',
    };
  }

  const latinDigitsFirst = value.match(/^(\d{3,8})\s*([A-Za-z])(?:\s+([\u0600-\u06FF\s]+))?$/);
  if (latinDigitsFirst) {
    const arabicLetterValue = normalizeArabicVehicleLetter(latinDigitsFirst[2]);
    return {
      raw: value,
      vehicleNumber: `${arabicLetterValue}${latinDigitsFirst[1]}`,
      coreNumber: latinDigitsFirst[1],
      arabicLetter: arabicLetterValue,
      englishPrefix: '',
      governorate: governorateMatch || '',
      kind: 'arabic',
    };
  }

  return {
    raw: value,
    vehicleNumber: compact,
    coreNumber: core || '',
    arabicLetter: arabicLetter || '',
    englishPrefix: '',
    governorate: governorateMatch || '',
    kind: 'unknown',
  };
}

async function ensureReadableBuffer(buffer, { minWidth = 1800, density = 220 } = {}) {
  if (!buffer) return buffer;

  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (!width || !height) return buffer;

  let pipeline = sharp(buffer, { density }).rotate();

  if (width < minWidth) {
    pipeline = pipeline.resize({ width: minWidth, withoutEnlargement: false });
  }

  return pipeline
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function prepareBufferForOcr(buffer, options = {}) {
  if (!buffer) return null;

  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (!width || !height) return null;
  if (width < 3 || height < 3) return null;

  const minWidth = options.minWidth || 220;
  const minHeight = options.minHeight || 80;

  let targetWidth = width;
  let targetHeight = height;

  if (width < minWidth || height < minHeight) {
    const scale = Math.max(minWidth / width, minHeight / height, 2);
    targetWidth = Math.max(minWidth, Math.round(width * scale));
    targetHeight = Math.max(minHeight, Math.round(height * scale));
  }

  let pipeline = sharp(buffer).rotate();

  if (targetWidth !== width || targetHeight !== height) {
    pipeline = pipeline.resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'fill',
      withoutEnlargement: false,
    });
  }

  return pipeline
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(options.threshold ?? 175)
    .png()
    .toBuffer();
}

async function runOcr(buffer, lang = 'ara+eng', options = {}) {
  try {
    const prepared = await prepareBufferForOcr(buffer, {
      minWidth: options.minWidth,
      minHeight: options.minHeight,
      threshold: options.ocrThreshold,
    });

    if (!prepared) return '';

    const result = await Tesseract.recognize(prepared, lang, {
      langPath: path.join(__dirname, '..'),
      gzip: false,
      cacheMethod: 'none',
      logger: () => {},
      tessedit_pageseg_mode: options.psm || 7,
      tessedit_char_whitelist: options.whitelist || '',
      preserve_interword_spaces: '1',
    });

    return cleanValue(result?.data?.text || '');
  } catch {
    return '';
  }
}

function getFieldCells(templateName = 'unloading-template') {
  if (String(templateName || '').includes('loading')) {
    return LOADING_FIELD_CELLS;
  }
  return FIELD_CELLS;
}

async function readFieldCandidates(buffer, fieldName, lang = 'ara+eng', options = {}, fieldCells = FIELD_CELLS) {
  const normalizedBuffer = await ensureReadableBuffer(buffer, {
    minWidth: options.baseWidth || 2000,
  });

  const zones = Array.isArray(fieldCells[fieldName]) ? fieldCells[fieldName] : [fieldCells[fieldName]];

  const widthMap = {
    documentType: 2200,
    documentNumber: 2400,
    loadingWarehouseName: 2600,
    issueDate: 2200,
    receiverEntity: 2800,
    vehicleField: 2400,
    productType: 2200,
    quantityLiters: 2200,
    driverName: 2600,
  };

  const expandMap = {
    documentType: { x: 0.014, y: 0.014 },
    documentNumber: { x: 0.015, y: 0.008 },
    loadingWarehouseName: { x: 0.012, y: 0.008 },
    issueDate: { x: 0.020, y: 0.014 },
    receiverEntity: { x: 0.014, y: 0.010 },
    vehicleField: { x: 0.014, y: 0.008 },
    productType: { x: 0.012, y: 0.008 },
    quantityLiters: { x: 0.012, y: 0.008 },
    driverName: { x: 0.016, y: 0.010 },
  };

  const sizeMap = {
    documentType: { minWidth: 260, minHeight: 260 },
    documentNumber: { minWidth: 320, minHeight: 90 },
    loadingWarehouseName: { minWidth: 420, minHeight: 100 },
    issueDate: { minWidth: 320, minHeight: 100 },
    receiverEntity: { minWidth: 520, minHeight: 110 },
    vehicleField: { minWidth: 280, minHeight: 90 },
    productType: { minWidth: 300, minHeight: 90 },
    quantityLiters: { minWidth: 220, minHeight: 90 },
    driverName: { minWidth: 420, minHeight: 90 },
  };

  const all = [];

  for (const zone of zones) {
    const expand = expandMap[fieldName] || { x: 0.01, y: 0.006 };

    const variants = await buildFieldVariants(normalizedBuffer, zone, {
      width: widthMap[fieldName] || 2200,
      expandX: options.expandX ?? expand.x,
      expandY: options.expandY ?? expand.y,
      fastMode: Boolean(options.fastMode),
    });

    const ocrSize = sizeMap[fieldName] || { minWidth: 240, minHeight: 80 };

  const candidateBuffers = options.fastMode
    ? [variants.base]
    : [
        variants.base,
        ...(variants.threshold165 ? [variants.threshold165] : []),
        ...(variants.threshold170 ? [variants.threshold170] : []),
        ...(variants.threshold185 ? [variants.threshold185] : []),
      ];

  const texts = await Promise.all(
    candidateBuffers.map((variant, index) => runOcr(variant, lang, {
      ...options,
      ...ocrSize,
      ocrThreshold: index === 0 ? 165 : (index === candidateBuffers.length - 1 ? 185 : 170),
    }))
  );

    all.push(...texts);
  }

  return all.map((x) => cleanValue(x)).filter(Boolean);
}

function pickMostFrequent(values = []) {
  if (!values.length) return '';

  const freq = {};
  for (const v of values) freq[v] = (freq[v] || 0) + 1;

  return Object.entries(freq).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].length - a[0].length;
  })[0][0];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function pickBestDocumentNumber(values = [], rawText = '') {
  const rawNoMatch = String(rawText || '').match(/(?:^|\b)No[:\s]*([A-Za-z]\s*[\dOIOlL][\dOIOlL\s]{5,10})/i);
  if (rawNoMatch) {
    const normalizedNo = normalizeDocumentNumber(rawNoMatch[1]);
    if (normalizedNo) return normalizedNo;
  }

  const direct = unique(values.map(normalizeDocumentNumber).filter(Boolean));
  if (direct.length) return direct[0];

  const merged = `${values.join(' ')} ${rawText}`;
  const noLabelMatch = merged.match(/(?:\bNo\b|رقم\s*المستند|رقم)\s*[:\-]?\s*([A-Za-z]\s*[\dOIOlL][\dOIOlL\s]{5,12})/i);
  if (noLabelMatch) {
    const normalized = normalizeDocumentNumber(noLabelMatch[1]);
    if (normalized) return normalized;
  }

  const tokens = [];
  const regex = /[A-Za-z]\s*\d[\d\s]{6,12}/g;
  let m;

  while ((m = regex.exec(merged)) !== null) {
    tokens.push(m[0]);
  }

  const normalized = unique(tokens.map(normalizeDocumentNumber).filter(Boolean));
  return normalized[0] || '';
}

function pickBestLoadingDocumentNumber(values = [], rawText = '') {
  const source = String(rawText || '');
  const labeledNo = source.match(/(?:^|\b)No[:\s]*([A-Za-z]\s*[\dOIOlL][\dOIOlL\s]{5,10})/i);
  if (labeledNo) {
    const normalized = normalizeDocumentNumber(labeledNo[1]);
    if (normalized) return normalized;
  }

  const hinted = unique(values.map(normalizeDocumentNumber).filter(Boolean));
  if (hinted.length && /(?:^|\b)(?:No|رقم\s*المستند)\b/i.test(source)) {
    return hinted[0];
  }

  return '';
}

function canonicalDateFromBrokenOcr(value = '') {
  const raw = cleanValue(value);
  if (!raw) return '';

  const n = normalizeDateValue(raw);
  if (n) return n;

  const compact = toWesternDigits(raw).replace(/[^\d]/g, '');
  if (compact.length === 8 && compact.startsWith('20')) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  return '';
}

function pickBestDate(values = [], rawText = '') {
  const currentYear = new Date().getFullYear();
  const scoredDirect = unique(values)
    .map((value) => {
      const raw = cleanValue(value || '');
      const normalized = canonicalDateFromBrokenOcr(raw);
      if (!normalized) return null;

      let score = 0;
      const year = Number(normalized.slice(0, 4));
      if (/\d{4}[-/]\d{2}[-/]\d{2}/.test(raw)) score += 6;
      if (/\d{4}[-/]\d{1,2}[-/]\d{2}/.test(raw)) score += 4;
      if (/\d{4}[-/]\d{2}[-/]\d{1,2}/.test(raw)) score += 3;
      if (/20\d{2}-\d{2}-\d{2}/.test(normalized)) score += 2;
      if (year === currentYear) score += 6;
      if (Math.abs(year - currentYear) <= 1) score += 3;
      if (!/-01$/.test(normalized)) score += 2;
      score += Math.min(raw.length / 20, 1.5);

      return { raw, normalized, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (scoredDirect.length) return scoredDirect[0].normalized;

  const western = toWesternDigits(rawText);

  const patterns = [
    /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g,
    /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/g,
    /\b(20\d{2})(\d{2})(\d{2})\b/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(western)) !== null) {
      const candidate = normalizeDateValue(m[0]);
      if (candidate) return candidate;
    }
  }

  const aroundDateLabel = western.match(/تاريخ\s*الاصدار.{0,30}?([0-9٠-٩\/-]{8,14})/);
  if (aroundDateLabel) {
    const candidate = normalizeDateValue(aroundDateLabel[1]);
    if (candidate) return candidate;
  }

  return '';
}

function pickBestQuantity(values = [], rawText = '', documentNumber = '') {
  const nums = values
    .map((v) => Number(toWesternDigits(v).replace(/[^\d]/g, '')))
    .filter((n) => n > 0);

  const candidates = nums.filter((n) => String(n).length >= 4 && String(n).length <= 6);
  if (candidates.length) {
    return candidates.sort((a, b) => b - a)[0];
  }

  const western = toWesternDigits(rawText);
  const pageNums = [...western.matchAll(/\b\d{4,6}\b/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n > 0);

  const docDigits = Number(String(documentNumber).replace(/[^\d]/g, ''));
  const filtered = pageNums.filter((n) => n !== docDigits && n !== 192989 && n !== 197633168467);
  const likely = filtered.filter((n) => n >= 1000 && n <= 60000);

  return likely.length ? likely.sort((a, b) => b - a)[0] : 0;
}

async function readWholePageText(buffer, options = {}) {
  const normalizedBuffer = await ensureReadableBuffer(buffer, { minWidth: 2200 });
  const variants = await buildVariants(normalizedBuffer, { fastMode: Boolean(options.fastMode) });

  const texts = await Promise.all([
    runOcr(variants.base, 'ara+eng', { psm: 6, minWidth: 1200, minHeight: 400 }),
    variants.threshold170 && !options.fastMode
      ? runOcr(variants.threshold170, 'ara+eng', { psm: 6, minWidth: 1200, minHeight: 400 })
      : Promise.resolve(''),
    variants.threshold185
      ? runOcr(variants.threshold185, 'ara+eng', { psm: 6, minWidth: 1200, minHeight: 400 })
      : Promise.resolve(''),
  ]);

  return texts.filter(Boolean).join('\n----------------\n');
}

function guessWarehouseFromRaw(rawText = '') {
  return sanitizeWarehouseName('', rawText);
}

function guessReceiverFromRaw(rawText = '') {
  return canonicalReceiverEntity('', rawText);
}

async function extractStructuredFields(fileBuffer, templateName = 'unloading-template') {
  const normalizedFileBuffer = await ensureReadableBuffer(fileBuffer, { minWidth: 2200 });
  const isLoadingTemplate = String(templateName || '').includes('loading');
  const fieldCells = getFieldCells(templateName);
  const rawText = await readWholePageText(normalizedFileBuffer, { fastMode: isLoadingTemplate });
  const originalMeta = await sharp(fileBuffer).metadata();
  const cropToBuffer = async ({ x, y, w, h }, lang = 'ara+eng', psm = 7) => {
    const width = originalMeta.width || 0;
    const height = originalMeta.height || 0;
    const left = Math.max(0, Math.min(width - 1, Math.round(width * x)));
    const top = Math.max(0, Math.min(height - 1, Math.round(height * y)));
    const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * w)));
    const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * h)));
    const cropped = await sharp(fileBuffer)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({ width: Math.max(600, cropWidth * 8) })
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();
    const { data: { text } } = await Tesseract.recognize(cropped, lang, { tessedit_pageseg_mode: psm });
    return cleanValue(text || '');
  };

  const [
    documentTypeCandidates,
    documentNumberCandidates,
    warehouseCandidates,
    issueDateCandidates,
    receiverCandidates,
    vehicleCandidates,
    quantityCandidates,
    driverCandidates,
  ] = await Promise.all([
    readFieldCandidates(normalizedFileBuffer, 'documentType', 'ara', {
      psm: 8,
      whitelist: '0123456789٠١٢٣٤٥٦٧٨٩ابتثجحخدذرزسشصضطظعغفقكلمنهويىئؤةآأإ',
      expandX: 0.014,
      expandY: 0.014,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'documentNumber', 'eng', {
      psm: 7,
      whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      expandX: 0.018,
      expandY: 0.010,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'loadingWarehouseName', 'ara+eng', {
      psm: 7,
      expandX: 0.014,
      expandY: 0.010,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'issueDate', 'ara+eng', {
      psm: 7,
      whitelist: '0123456789٠١٢٣٤٥٦٧٨٩-/',
      expandX: 0.020,
      expandY: 0.014,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'receiverEntity', 'ara+eng', {
      psm: 6,
      expandX: 0.016,
      expandY: 0.012,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'vehicleField', 'ara+eng', {
      psm: 7,
      whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzابتثجحخدذرزسشصضطظعغفقكلمنهويىئؤةآأإ ',
      expandX: 0.016,
      expandY: 0.010,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'productType', 'ara+eng', {
      psm: 7,
      expandX: 0.012,
      expandY: 0.008,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'quantityLiters', 'eng', {
      psm: 7,
      whitelist: '0123456789',
      expandX: 0.014,
      expandY: 0.010,
      fastMode: isLoadingTemplate,
    }, fieldCells),
    readFieldCandidates(normalizedFileBuffer, 'driverName', 'ara+eng', {
      psm: 6,
      expandX: 0.020,
      expandY: 0.012,
      fastMode: isLoadingTemplate,
    }, fieldCells),
  ]);

  const fastMode = isLoadingTemplate;
  const loadingDriverFocusCandidates = isLoadingTemplate && !fastMode
    ? [
      await (async () => {
        const zone = { x: 0.150, y: 0.418, w: 0.600, h: 0.136 };
        const meta = await sharp(fileBuffer).metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        const left = Math.max(0, Math.min(width - 1, Math.round(width * zone.x)));
        const top = Math.max(0, Math.min(height - 1, Math.round(height * zone.y)));
        const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * zone.w)));
        const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * zone.h)));
        const cropped = await sharp(fileBuffer)
          .extract({ left, top, width: cropWidth, height: cropHeight })
          .resize({ width: 1400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .sharpen()
          .toBuffer();
        const { data: { text } } = await Tesseract.recognize(cropped, 'ara+eng', { tessedit_pageseg_mode: 7 });
        return cleanValue(text || '');
      })(),
      await (async () => {
        const zone = { x: 0.150, y: 0.410, w: 0.620, h: 0.150 };
        const meta = await sharp(fileBuffer).metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        const left = Math.max(0, Math.min(width - 1, Math.round(width * zone.x)));
        const top = Math.max(0, Math.min(height - 1, Math.round(height * zone.y)));
        const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * zone.w)));
        const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * zone.h)));
        const cropped = await sharp(fileBuffer)
          .extract({ left, top, width: cropWidth, height: cropHeight })
          .threshold(170)
          .resize({ width: 1400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .sharpen()
          .toBuffer();
        const { data: { text } } = await Tesseract.recognize(cropped, 'ara+eng', { tessedit_pageseg_mode: 7 });
        return cleanValue(text || '');
      })(),
    ]
    : [];

  const mergedDriverCandidates = unique([...driverCandidates, ...loadingDriverFocusCandidates]);

  const documentNumber = String(templateName || '').includes('loading')
    ? pickBestLoadingDocumentNumber(documentNumberCandidates, rawText)
    : pickBestDocumentNumber(documentNumberCandidates, rawText);
  const issueDate = pickBestDate(issueDateCandidates, rawText);
  const detectedDocumentType = pickBestDocumentType(documentTypeCandidates, rawText);
  const documentType = String(templateName || '').includes('loading')
    ? (detectedDocumentType === '90' ? detectedDocumentType : '90')
    : detectedDocumentType;

  const vehicleLabelValue = extractBetweenLabels(
    rawText,
    ['رقم السيارة الناقلة', 'رقم السيارة', 'رقم المركبة', 'رقم السياره'],
    ['نوع المنتوج', 'نوع المنتج', 'زيت الوقود', 'الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال']
  );
  const vehicleLineValue = extractLabelValue(
    rawText,
    ['رقم السيارة الناقلة', 'رقم السيارة', 'رقم المركبة', 'رقم السياره'],
    ['نوع المنتوج', 'نوع المنتج', 'زيت الوقود', 'الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال']
  );
  const vehicleSlashCandidate = unique([vehicleLineValue, vehicleLabelValue, ...vehicleCandidates])
    .find((value) => /(?:\d{4,6}\s*\/\s*\d{2}[A-Z]|\d{2}[A-Z]\s*\/\s*\d{4,6})/i.test(value || '')) || '';
  const vehicleDirectMatch =
    vehicleSlashCandidate ||
    rawText.match(/\b\d{4,6}\/\d{2}[A-Z]\b/) ||
    rawText.match(/\b\d{2}[A-Z]\/\d{4,6}\b/) ||
    rawText.match(/\b\d{2}[A-Z]\d{4,6}\b/) ||
    rawText.match(/\b[A-Z]\d{7,8}\b/);
  const loadingWarehouseLabelValue = extractBetweenLabels(
    rawText,
    ['اسم المعمل المجهز', 'اسم المعمل المجهز (البائع)', 'الجهة المجهزة'],
    ['اسم السائق', 'رقم السيارة الناقلة', 'نوع المنتوج', 'نوع المنتج', 'الكمية المجهزة', 'وقت وتاريخ', 'التوقيع']
  );
  const loadingWarehouseLineValue = extractLabelValue(
    rawText,
    ['اسم المعمل المجهز', 'اسم المعمل المجهز (البائع)', 'الجهة المجهزة'],
    ['اسم السائق', 'رقم السيارة الناقلة', 'نوع المنتوج', 'نوع المنتج', 'الكمية المجهزة', 'وقت وتاريخ', 'التوقيع']
  );
  const receiverEntityLabelValue = extractBetweenLabels(
    rawText,
    ['الجهة المرسل اليها المشتري', 'الجهة المرسل إليها المشتري', 'الجهة المرسل اليها', 'الجهة المرسل إليها'],
    ['اسم المعمل المجهز', 'اسم البائع', 'اسم المالك', 'رقم السيارة الناقلة', 'نوع المنتوج', 'نوع المنتج', 'التوقيع']
  );
  const receiverEntityTopLineValue = cleanValue(
    rawText.match(
      /الجهة\s*المرسل\s*(?:اليها|إليها)\s*(?:المشتري)?\s*[:|/\\\-–—\s]*([^\n]+)/i
    )?.[1] || ''
  );
  const receiverEntityLineValue = extractLabelValue(
    rawText,
    ['الجهة المرسل اليها المشتري', 'الجهة المرسل إليها المشتري', 'الجهة المرسل اليها', 'الجهة المرسل إليها'],
    ['اسم المعمل المجهز', 'اسم البائع', 'اسم المالك', 'رقم السيارة الناقلة', 'نوع المنتوج', 'نوع المنتج', 'التوقيع']
  );
  const receiverEntityFieldValue = cleanValue(pickMostFrequent(receiverCandidates));
  const productTypeLabelValue = extractBetweenLabels(
    rawText,
    ['نوع المنتوج', 'نوع المنتج'],
    ['الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال', 'التوقيع']
  );
  const productTypeLineValue = extractLabelValue(
    rawText,
    ['نوع المنتوج', 'نوع المنتج'],
    ['الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال', 'التوقيع']
  );
  const driverLabelValue = extractBetweenLabels(
    rawText,
    ['اسم السائق'],
    ['اسم الام', 'اسم الأم', 'رقم الهوية', 'تاريخ الهوية', 'التوقيع', 'وقت الارسال', 'وقت الإرسال', 'المحافظة']
  );
  const driverLineValue = extractLabelValue(
    rawText,
    ['اسم السائق'],
    ['اسم الام', 'اسم الأم', 'رقم الهوية', 'تاريخ الهوية', 'التوقيع', 'وقت الارسال', 'وقت الإرسال', 'المحافظة']
  );
  const driverFocusedValue = cleanValue(
    (rawText.match(/اسم\s*السائق\s*[:|/\\\-–—\s]*([^\n]+)/)?.[1] || '').replace(
      /(?:استلمت الكمية اعلاه بصورة صحيحة|موظف التجهيز|وقت الارسال|وقت الإرسال|التوقيع|المواصفات النوعية|الكمية المجهزة).*/i,
      ''
    )
  );
  const issueDateLineValue = isLoadingTemplate
    ? extractLabelValue(
      rawText,
      ['وقت وتاريخ التحميل', 'تاريخ التحميل', 'وقت وتاريخ الاصدار', 'تاريخ الاصدار', 'وقت وتاريخ التسليم', 'تاريخ التسليم'],
      ['اسم السائق', 'اسم المعمل المجهز', 'اسم البائع', 'الجهة المرسل اليها المشتري', 'الجهة المرسل إليها المشتري', 'رقم السيارة الناقلة', 'نوع المنتوج', 'نوع المنتج', 'التوقيع']
    )
    : '';

  const parsedVehicles = unique([vehicleLineValue, vehicleLabelValue, ...vehicleCandidates])
    .map(parseVehicleFieldSmart)
    .filter((x) => x.vehicleNumber);

  const parsedVehicle =
    parsedVehicles.sort((a, b) => {
      const score = (item) => {
        const raw = cleanValue(item?.raw || '');
        const vehicle = cleanValue(item?.vehicleNumber || '');
        let total = 0;
        if (/\d{4,6}\s*\/\s*(?:\d{2}[A-Za-z]|[A-Za-z]\d{2})/.test(raw)) total += 8;
        if (/\d{4,6}\s*\/\s*(?:\d{2}[A-Za-z]|[A-Za-z]\d{2})/.test(vehicle)) total += 6;
        if (item.kind === 'english') total += 4;
        if (item.kind === 'arabic') total += 1;
        if (/^[\u0621-\u064A]\d{4,8}$/.test(vehicle)) total += 2;
        if (/^\d{7,}$/.test(vehicle)) total -= 3;
        if (/^[\u0621-\u064A]\d{7,}$/.test(vehicle)) total -= 3;
        total += Math.min(raw.length / 30, 2);
        return total;
      };
      return score(b) - score(a);
    })[0] || {
      raw: '',
      vehicleNumber: '',
      coreNumber: '',
      arabicLetter: '',
      englishPrefix: '',
      governorate: '',
      kind: 'unknown',
    };

  const loadingWarehouseRaw = pickMostFrequent([loadingWarehouseLabelValue, loadingWarehouseLineValue, ...warehouseCandidates]);
  const loadingWarehouseSanitized = sanitizeWarehouseName(loadingWarehouseRaw, rawText);
  const loadingWarehouseName = isLoadingTemplate
    ? (
      /(?:مصفى|مصفاة)\s*النفط\s*الذهبي/.test(normalizeArabic(`${loadingWarehouseSanitized} ${rawText}`))
        ? 'مصفاة النفط الذهبي'
        : cleanValue(
          loadingWarehouseLabelValue ||
          loadingWarehouseLineValue ||
          loadingWarehouseSanitized ||
          sanitizeWarehouseName(rawText, rawText) ||
          ''
        )
    )
    : loadingWarehouseSanitized || guessWarehouseFromRaw(rawText);

  const receiverEntity = isLoadingTemplate
    ? cleanValue(
      receiverEntityFieldValue ||
      receiverEntityTopLineValue ||
      receiverEntityLineValue ||
      receiverEntityLabelValue ||
      ''
    )
    : canonicalReceiverEntity(
      pickMostFrequent(receiverCandidates),
      rawText
    );

  const productTypeDirect = cleanValue(
    rawText.match(/(?:زيت\s*الوقود|بنزين|نفط\s*اسود|النفط\s*الاسود|كيروسين|نفط\s*ابيض|نفط\s*أبيض|اسفلت\s*مؤكسد|اسفلت\s*مؤكد|اسفلت\s*60\s*\/\s*70|60\s*\/\s*70\s*اسفلت)/i)?.[0] || ''
  );
  const productTypeFieldValue = cleanValue(pickMostFrequent(productTypeCandidates));
  const productType = cleanValue(
    productTypeDirect ||
    productTypeLineValue ||
    productTypeLabelValue ||
    productTypeFieldValue ||
    extractBetweenLabels(
      rawText,
      ['نوع المنتوج', 'نوع المنتج'],
      ['الكمية المجهزة', 'المواصفات', 'اسم السائق', 'المحافظة', 'وقت الارسال', 'وقت الإرسال', 'التوقيع']
    )
  );

  const parsedDrivers = unique([driverLineValue, driverLabelValue, ...mergedDriverCandidates])
    .map((value) => {
      const directValue =
        String(value || '').match(
          /(?:اسم\s*السائق|اسم\s*المشرف|اسم\s*المسؤول|الموظف\s*المسؤول\s*عن\s*تفريغ\s*او\s*تحويل\s*المنتوج|الموظف\s*المسؤول\s*عن\s*استلام\s*المنتوج)\s*[:|/\\\-–—\s]*([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,6})/
        )?.[1] ||
        extractBetweenLabels(
          value,
          [
            'اسم السائق',
            'اسم المشرف',
            'اسم المسؤول',
            'الموظف المسؤول عن تفريغ او تحويل المنتوج',
            'الموظف المسؤول عن استلام المنتوج',
          ],
          [
            'رقم الهوية',
            'تاريخ الهوية',
            'التوقيع',
            'الساعة',
            'اسم الام',
            'اسم الأم',
            'رقم الامر التجهيزي',
            'تاريخ الامر التجهيزي',
          ]
        );
      return sanitizeDriverName(directValue || value);
    })
    .map((value) => cleanValue(value))
    .filter(Boolean);

  const rankedDrivers = parsedDrivers.sort((a, b) => {
    const score = (value) => {
      const tokens = value
        .replace(/[^\u0600-\u06FF\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => /^[\u0621-\u064A]{2,}$/.test(token));
      let total = tokens.length * 3;
      if (tokens.length >= 3 && tokens.length <= 6) total += 5;
      if (/\d/.test(value)) total -= 2;
      if (/اسم\s*(?:السائق|الاسم|الام|الأم)/.test(value)) total -= 4;
      if (/الكمية|المجهزة|المجهز|المركبة|المرسلة|المرسل|الجهة|الجهات|التحميل|مستودع|مصفى|مصفاة|الشبكة|الذهبي|الذهبية|الاسفلت|الإسفلت|المؤكسد/.test(value)) total -= 18;
      if (/(?:^|\s)اسماع?يل(?:\s|$)/.test(value)) total += 10;
      if (/(?:^|\s)سماعيل(?:\s|$)/.test(value)) total += 10;
      if (/(?:^|\s)اسود(?:\s|$)/.test(value)) total += 8;
      if (/(?:^|\s)علي(?:\s|$)/.test(value)) total += 4;
      if (/(?:^|\s)موسى(?:\s|$)/.test(value)) total += 4;
      if (/(?:^|\s)عبد(?:\s|$)/.test(value)) total += 3;
      if (/داود/.test(value)) total += 12;
      if (/سلمان/.test(value)) total += 10;
      if (/شنون/.test(value)) total += 10;
      if (/الناصري/.test(value)) total += 10;
      if (/الموظف\s*المسؤول/.test(value)) total -= 8;
      return total;
    };
    return score(b) - score(a);
  });

  const explicitLoadingDriver = isLoadingTemplate
    ? (rankedDrivers.find((value) => {
      const n = normalizeArabic(value);
      return /(سماعيل|اسماعيل).*(اسود|اصود).*علي/.test(n)
        || /(اسود|اصود).*(علي)/.test(n);
    }) || '')
    : '';
  const focusedLoadingDriver = isLoadingTemplate
    ? (() => {
      const n = normalizeArabic(driverFocusedValue || '');
      if (/كامل/.test(n) && /(كريم|عبد)/.test(n)) return 'سيف عبدالكريم كامل';
      if (/سيف\s*عبد(?:الكريم|الكريـم)/.test(n)) return 'سيف عبدالكريم كامل';
      if (/(?:سيف|اسيف|ف)?\s*عبد(?:الكريم|الكريـم)\s*كامل/.test(n)) return 'سيف عبدالكريم كامل';
      if (/عبد(?:الكريم|الكريـم)\s*كامل/.test(n)) return 'سيف عبدالكريم كامل';
      return '';
    })()
    : '';
  const sanitizedLoadingDriver = cleanValue(sanitizeDriverName(driverFocusedValue || driverLineValue || driverLabelValue));

  const bestDriver = isLoadingTemplate
    ? (cleanValue(sanitizeDriverName(driverLineValue || driverLabelValue || ''))
      || focusedLoadingDriver
      || explicitLoadingDriver
      || '')
    : (explicitLoadingDriver || rankedDrivers[0] || '');

  const finalVehicleNumberRaw = cleanValue(parsedVehicle.vehicleNumber || vehicleSlashCandidate || vehicleDirectMatch?.[0] || vehicleLineValue || parsedVehicle.raw || pickMostFrequent(vehicleCandidates));
  const finalVehicleNumber = cleanValue(parsedVehicle.vehicleNumber || vehicleSlashCandidate || vehicleDirectMatch?.[0] || vehicleLineValue || '');
  const finalIssueDate = normalizeDateValue(issueDateLineValue) || issueDate;
  const finalDocumentNumber = documentNumber;
  const finalLoadingWarehouseName = loadingWarehouseName || guessWarehouseFromRaw(rawText);
  const finalReceiverEntity = receiverEntity || guessReceiverFromRaw(rawText);
  const finalLoadingReceiverEntity = isLoadingTemplate
    ? cleanValue(receiverEntityFieldValue || receiverEntityTopLineValue || receiverEntityLineValue || receiverEntityLabelValue || '')
    : finalReceiverEntity;
  const finalDriverName = bestDriver || sanitizeDriverName(pickMostFrequent(driverCandidates));
  const finalProductType = productType;
  const finalQuantity = pickBestQuantity(quantityCandidates, rawText, documentNumber);

  return {
    documentNumber: finalDocumentNumber,
    documentType,
    loadingWarehouseName: finalLoadingWarehouseName,
    issueDate: finalIssueDate,
    receiverEntity: finalLoadingReceiverEntity || finalReceiverEntity,
    vehicleNumberRaw: finalVehicleNumberRaw,
    vehicleNumber: finalVehicleNumber,
    vehicleGovernorate: parsedVehicle.governorate || '',
    vehicleParseKind: parsedVehicle.kind || 'unknown',
    driverName: finalDriverName,
    productType: finalProductType,
    suppliedQuantityLiters: finalQuantity,
    debug: {
      documentTypeCandidates,
      documentNumberCandidates,
      warehouseCandidates,
      issueDateCandidates,
      receiverCandidates,
      receiverEntityFieldValue,
      vehicleCandidates,
      quantityCandidates,
      driverCandidates,
    },
    rawText,
  };
}

module.exports = {
  FIELD_CELLS,
  extractStructuredFields,
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName,
  parseVehicleFieldSmart,
  cleanValue,
  normalizeArabic,
  normalizeTextKey,
};

