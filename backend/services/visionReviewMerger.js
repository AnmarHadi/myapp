const { canonicalVehicleValue, normalizeWarehouseCandidate } = require('./unloadingStrictChecks');
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

const VISION_FIELDS = [
  'documentNumber',
  'documentType',
  'issueDate',
  'loadingWarehouseName',
  'receiverEntity',
  'vehicleNumber',
  'driverName',
  'productType',
  'suppliedQuantityLiters',
];

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeQuantity(value = '') {
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
  const western = String(value || '').replace(/[\u0660-\u0669]/g, (d) => map[d] || d);
  const matches = western.match(/\d{3,6}/g) || [];
  const values = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 1000 && item <= 60000);
  if (!values.length) return '';
  return String(values.sort((a, b) => b - a)[0]);
}

function normalizeProductType(value = '') {
  return cleanValue(value || '');
}

function stripLoadingReceiverLabel(value = '') {
  const source = cleanValue(value);
  return source
    .replace(/^.*?\u0627\u0644\u062c\u0647\u0629\s*\u0627\u0644\u0645\u0631\u0633\u0644\s*(?:\u0627\u0644\u064a\u0647\u0627|\u0625\u0644\u064a\u0647\u0627)\s*(?:\u0627\u0644\u0645\u0634\u062a\u0631\u064a)?\s*[:\-]?\s*/i, '')
    .replace(/^.*?\u0627\u0644\u062c\u0647\u0629\s*\u0627\u0644\u0645\u0635\u062f\u0631\s*\u0644\u0647\u0627\s*[:\-]?\s*/i, '')
    .replace(/^.*?\u0627\u0644\u062c\u0647\u0629\s*\u0627\u0644\u0645\u0631\u0633\u0644\s*\u0627\u0644\u064a\u0647\u0627\s*[:\-]?\s*/i, '');
}

function hasArabicNameShape(value = '') {
  const tokens = cleanValue(value).split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && !/\d/.test(value) && /[\u0600-\u06FF]/.test(value);
}

function normalizeDriverField(value = '') {
  const sanitized = sanitizeDriverName(value || '');
  const repaired = repairBrokenWords(cleanValue(value || ''));
  const fallback = cleanValue(repaired || value || '');

  if (sanitized && hasArabicNameShape(sanitized)) return sanitized;
  if (fallback && hasArabicNameShape(fallback)) return fallback;
  return sanitized || fallback || '';
}

function normalizeReceiverEntity(value = '', registrationMode = 'unloading') {
  const repaired = repairBrokenWords(cleanValue(value));
  const stripped = stripLoadingReceiverLabel(repaired);
  if (registrationMode === 'loading') {
    return cleanValue(stripped || repaired);
  }

  return isGoldenRefinery(repaired)
    ? (canonicalReceiverEntity(repaired, '') || repaired)
    : repaired;
}

function normalizeFieldValue(field, value = '', registrationMode = 'unloading') {
  if (field === 'documentNumber') return normalizeDocumentNumber(value || '');
  if (field === 'documentType') return canonicalDocumentType(value || '');
  if (field === 'issueDate') return normalizeDateValue(value || '');
  if (field === 'loadingWarehouseName') return sanitizeWarehouseName(normalizeWarehouseCandidate(value || ''));
  if (field === 'receiverEntity') return normalizeReceiverEntity(value || '', registrationMode);
  if (field === 'vehicleNumber') return canonicalVehicleValue(value || '');
  if (field === 'driverName') return normalizeDriverField(value || '');
  if (field === 'productType') return normalizeProductType(value || '');
  if (field === 'suppliedQuantityLiters') return normalizeQuantity(value || '');
  return cleanValue(value || '');
}

function normalizeFieldKey(field, value = '', registrationMode = 'unloading') {
  const normalized = normalizeFieldValue(field, value, registrationMode);
  if (!normalized) return '';
  if (field === 'suppliedQuantityLiters') return String(Number(normalized || 0));
  return normalizeTextKey(normalized);
}

function isFieldValid(field, value = '', registrationMode = 'unloading') {
  const normalized = normalizeFieldValue(field, value, registrationMode);
  if (!normalized) return false;

  if (field === 'documentNumber') return /^[A-Z]\d{7,8}$/.test(normalized);
  if (field === 'documentType') return Boolean(normalized);
  if (field === 'issueDate') return Boolean(normalized);
  if (field === 'loadingWarehouseName') return /(?:\u0645\u0633\u062a\u0648\u062f\u0639|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629)/.test(normalized);
  if (field === 'receiverEntity') return Boolean(normalized);
  if (field === 'vehicleNumber') return Boolean(normalized);
  if (field === 'driverName') return hasArabicNameShape(normalized);
  if (field === 'productType') return Boolean(normalized);
  if (field === 'suppliedQuantityLiters') {
    const quantity = Number(normalized);
    return Number.isFinite(quantity) && quantity >= 1000 && quantity <= 60000;
  }

  return Boolean(normalized);
}

function scoreFieldValue(field, value = '', candidate = {}, reviewScore = 0, registrationMode = 'unloading') {
  const normalized = normalizeFieldValue(field, value, registrationMode);
  if (!normalized) return -Infinity;

  let score = clamp01(candidate.confidence, 0.5) * 8;
  score += safeNumber(reviewScore, 0) * 0.08;
  score += candidate.support > 1 ? Math.min(1.8, (candidate.support - 1) * 0.6) : 0;
  score += candidate.valid ? 1.5 : -0.5;

  if (field === 'documentNumber') {
    if (/^[A-Z]\d{7,8}$/.test(normalized)) score += 2.5;
  } else if (field === 'documentType') {
    if (normalized) score += 1.5;
  } else if (field === 'issueDate') {
    if (normalized) score += 2;
  } else if (field === 'loadingWarehouseName') {
    if (candidate.valid) score += 2;
    if (/(?:\u0634\u0631\u0643\u0629|\u0645\u0635\u0641\u0649|\u0645\u0635\u0641\u0627\u0629)/.test(normalized)) score += 0.5;
  } else if (field === 'receiverEntity') {
    if (registrationMode === 'loading') {
      if (/(?:\u0627\u0644\u0645\u0646\u0641\u0630|\u0627\u0644\u0628\u0635\u0631\u0629|\u062e\u0648\u0631|\u0627\u0644\u0632\u0628\u064a\u0631|\u0627\u0644\u0645\u064a\u0646\u0627\u0621|\u0627\u0644\u0645\u0635\u0646\u0639|\u0627\u0644\u0645\u0635\u0641\u0649|\u0627\u0644\u0645\u0639\u0645\u0644)/.test(normalized)) score += 2.2;
      if (/\//.test(normalized)) score += 0.5;
    } else if (isGoldenRefinery(normalized) || canonicalReceiverEntity(normalized, '')) {
      score += 2.2;
    }
  } else if (field === 'vehicleNumber') {
    if (normalized) score += 2.5;
  } else if (field === 'driverName') {
    if (hasArabicNameShape(normalized)) score += 2.5;
  } else if (field === 'productType') {
    if (normalized) score += 1.5;
    if (/(\b60\s*\/\s*70\b|\u0632\u064a\u062a|\u0648\u0642\u0648\u062f|\u0628\u0646\u0632\u064a\u0646|\u062f\u064a\u0632\u0644|\u0646\u0641\u0637)/.test(normalized)) score += 1;
  } else if (field === 'suppliedQuantityLiters') {
    const quantity = Number(normalized);
    if (Number.isFinite(quantity) && quantity >= 1000 && quantity <= 60000) score += 2.5;
  }

  return Number(score.toFixed(3));
}

function reviewScore(review = {}) {
  const fields = review?.fields || {};
  const useful = VISION_FIELDS
    .filter((field) => Boolean(normalizeFieldValue(field, fields[field] || '', 'loading')))
    .length;

  let score = Number(review?.score || 0);
  if (review?.success) score += 10;
  score += useful * 1.2;
  score += Array.isArray(review?.attempts) ? review.attempts.length * 0.35 : 0;
  score += Number(fields?.fieldConfidence?.vehicleNumber || 0) * 2;
  score += Number(fields?.fieldConfidence?.driverName || 0) * 1.8;
  score += Number(fields?.fieldConfidence?.loadingWarehouseName || 0) * 1.8;
  score += Number(fields?.fieldConfidence?.receiverEntity || 0) * 1.8;
  score += Number(fields?.fieldConfidence?.documentNumber || 0) * 1;
  score += Number(fields?.fieldConfidence?.issueDate || 0) * 0.8;
  score += Number(fields?.fieldConfidence?.productType || 0) * 0.8;
  return Number(score.toFixed(3));
}

function collectFieldCandidates(reviews = [], field, registrationMode = 'unloading') {
  const pool = new Map();

  for (const review of reviews) {
    const fields = review?.fields || {};
    const fieldConfidence = clamp01(fields?.fieldConfidence?.[field], 0);
    const reviewScoreValue = reviewScore(review);

    const candidates = [
      {
        value: fields[field] || '',
        confidence: fieldConfidence || clamp01(review?.confidence, 0.5),
        valid: isFieldValid(field, fields[field] || '', registrationMode),
        reviewScore: reviewScoreValue,
        source: review?.source || '',
      },
      ...asArray(review?.topCandidates?.[field]).map((candidate) => ({
        value: typeof candidate === 'string' ? candidate : candidate?.value || '',
        confidence: clamp01(
          typeof candidate === 'object' ? candidate?.confidence : fieldConfidence,
          fieldConfidence || clamp01(review?.confidence, 0.5)
        ),
        valid: typeof candidate === 'object' && typeof candidate.valid === 'boolean'
          ? candidate.valid
          : isFieldValid(field, typeof candidate === 'string' ? candidate : candidate?.value || '', registrationMode),
        reviewScore: reviewScoreValue,
        source: review?.source || '',
      })),
    ];

    for (const candidate of candidates) {
      const normalized = normalizeFieldValue(field, candidate.value, registrationMode);
      if (!normalized) continue;

      const key = normalizeFieldKey(field, normalized, registrationMode);
      if (!key) continue;

      const existing = pool.get(key) || {
        value: normalized,
        confidence: 0,
        score: -Infinity,
        support: 0,
        sources: new Set(),
        valid: false,
      };

      existing.support += 1;
      if (candidate.source) existing.sources.add(candidate.source);
      existing.valid = existing.valid || Boolean(candidate.valid);
      existing.confidence = Math.max(existing.confidence, clamp01(candidate.confidence, 0));

      const candidateScore = scoreFieldValue(
        field,
        normalized,
        {
          confidence: existing.confidence,
          support: existing.support,
          valid: existing.valid,
        },
        candidate.reviewScore,
        registrationMode
      );

      if (candidateScore > existing.score) {
        existing.score = candidateScore;
        existing.value = normalized;
      }

      pool.set(key, existing);
    }
  }

  const topCandidates = [...pool.values()]
    .map((item) => ({
      value: item.value,
      confidence: Number(Math.min(1, item.confidence + Math.max(0, item.support - 1) * 0.08).toFixed(3)),
      score: Number(item.score.toFixed(3)),
      support: item.support,
      valid: Boolean(item.valid),
      sources: [...item.sources].filter(Boolean),
    }))
    .sort((a, b) => {
      if (a.support !== b.support) return b.support - a.support;
      if (a.score !== b.score) return b.score - a.score;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.value.length - a.value.length;
    });

  return {
    value: topCandidates[0]?.value || '',
    confidence: topCandidates[0]?.confidence || 0,
    topCandidates: topCandidates.slice(0, 5),
  };
}

function pickBestReview(reviews = []) {
  const ordered = Array.isArray(reviews) ? reviews : [];
  const scored = ordered
    .map((review) => ({
      review,
      score: reviewScore(review),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.review || ordered[0] || {
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

function mergeVisionReviews(reviews = [], { registrationMode = 'unloading' } = {}) {
  const ordered = Array.isArray(reviews) ? reviews : [];
  const bestReview = pickBestReview(ordered);
  const mergedFields = { fieldConfidence: {} };
  const mergedTopCandidates = {};

  for (const field of VISION_FIELDS) {
    const merged = collectFieldCandidates(ordered, field, registrationMode);
    mergedFields[field] = merged.value;
    mergedFields.fieldConfidence[field] = merged.confidence;
    mergedTopCandidates[field] = merged.topCandidates;
  }

  if (registrationMode === 'loading') {
    mergedFields.receiverEntity = cleanValue(mergedFields.receiverEntity || '');
  }

  const usefulFieldCount = VISION_FIELDS.filter((field) => Boolean(cleanValue(mergedFields[field] || ''))).length;

  return {
    available: ordered.some((review) => Boolean(review?.available)) || usefulFieldCount > 0,
    success: ordered.some((review) => Boolean(review?.success)) || usefulFieldCount >= 4,
    message: bestReview?.message || '',
    fields: mergedFields,
    attempts: ordered.flatMap((review) => (
      Array.isArray(review?.attempts)
        ? review.attempts.map((attempt) => ({
          ...attempt,
          source: review?.source || attempt?.source || '',
          reviewScore: reviewScore(review),
        }))
        : []
    )),
    topCandidates: mergedTopCandidates,
    bestAttempt: bestReview?.bestAttempt || 0,
    score: reviewScore({ ...bestReview, fields: mergedFields }),
    model: bestReview?.model || '',
    source: bestReview?.source || '',
  };
}

module.exports = {
  mergeVisionReviews,
  scoreVisionReview: reviewScore,
};
