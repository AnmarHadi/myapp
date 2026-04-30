const Driver = require('../models/Driver')
const Vehicle = require('../models/Vehicle')
const LoadingWarehouse = require('../models/LoadingWarehouse')

const CANONICAL_RECEIVER_ENTITIES = [
  'مصفى النفط الذهبي',
  'معمل مصفى النفط الذهبي لإنتاج الأسفلت المؤكسد',
  'مصفى النفط الذهبي لإنتاج الأسفلت المؤكسد',
  'الشبكة الذهبية القابضة / مصفى النفط الذهبي / لإنتاج الأسفلت المؤكسد',
]

function normalizeArabic(value = '') {
  return String(value)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[^\u0600-\u06FF0-9A-Za-z\s/|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeVehicleText(value = '') {
  return String(value)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase()
}

function standardizeVehicleNumber(value = '') {
  const raw = normalizeVehicleText(value)
  if (!raw) return ''

  const v = raw.replace(/[^A-Z0-9/]/g, '')

  let m = v.match(/^(\d{3,6})\/(\d{1,3}[A-Z])$/)
  if (m) return `${m[2]}${m[1]}`

  m = v.match(/^(\d{1,3}[A-Z])\/(\d{3,6})$/)
  if (m) return `${m[1]}${m[2]}`

  m = v.match(/^(\d{3,6})\/([A-Z]\d{1,3})$/)
  if (m) return `${m[2]}${m[1]}`

  m = v.match(/^([A-Z]\d{1,3})\/(\d{3,6})$/)
  if (m) return `${m[1]}${m[2]}`

  const letters = v.match(/[A-Z]+/g) || []
  const numbers = v.match(/\d+/g) || []

  if (letters.length && numbers.length >= 2) {
    return `${numbers[numbers.length - 1]}${letters[0]}${numbers[0]}`
  }

  return v
}

function levenshtein(a = '', b = '') {
  const s = [...a]
  const t = [...b]
  const dp = Array.from({ length: s.length + 1 }, () =>
    Array(t.length + 1).fill(0)
  )

  for (let i = 0; i <= s.length; i++) dp[i][0] = i
  for (let j = 0; j <= t.length; j++) dp[0][j] = j

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }

  return dp[s.length][t.length]
}

function similarity(a = '', b = '') {
  const x = String(a || '')
  const y = String(b || '')
  if (!x && !y) return 1
  if (!x || !y) return 0

  const dist = levenshtein(x, y)
  const maxLen = Math.max(x.length, y.length)
  if (!maxLen) return 1

  return 1 - dist / maxLen
}

function tokenizeArabic(value = '') {
  return normalizeArabic(value)
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
}

function tokenOverlapScore(a = '', b = '') {
  const aTokens = tokenizeArabic(a)
  const bTokens = tokenizeArabic(b)

  if (!aTokens.length || !bTokens.length) return 0

  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)

  let common = 0
  for (const t of aSet) {
    if (bSet.has(t)) common++
  }

  const base = Math.max(aSet.size, bSet.size)
  if (!base) return 0

  return common / base
}

function uniqCandidateValues(candidates = []) {
  const out = []
  const seen = new Set()

  for (const item of candidates) {
    const value = typeof item === 'string' ? item : item?.value
    if (!value) continue
    const key = String(value).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }

  return out
}

function splitRawFragments(value = '') {
  return String(value || '')
    .split(/[|\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function removeCommonNoise(value = '') {
  return normalizeArabic(value)
    .replace(/\b(اسم|السائق|رقم|الهويه|الهوية|تاريخ|التوقيع|العنوان|الوظيفي|وقت|الارسال|الساعه|الشركه|الشركة|المخول|المدخول|اهلي|حول|ناقل)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanWarehouseCandidate(value = '') {
  let v = normalizeArabic(value)

  v = v
    .replace(/\b(الهياه|الهيئة|الهياة|او|الفرع|فرع)\b/g, ' ')
    .replace(/\b(الجهه|الجهة|المجهزه|المجهزة|للمنتوج|تاريخ|الاصدار|رقم|السياره|السيارة)\b/g, ' ')
    .replace(/\b(بدون|اجور|نقل|شركة|التوزيع)\b/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const m = v.match(/(مستودع\s+.+)$/)
  if (m) return m[1].trim()

  return v
}

function cleanDriverCandidate(value = '') {
  let v = normalizeArabic(value)

  v = v
    .replace(/\b(اسم|السائق|المنتوج|الموظف|المسؤول|عن|تفريغ|تحويل|الام|الأم|رقم|الهوية|الهويه|تاريخ|التوقيع|العنوان|الوظيفي|ملاحظات|ملاحظه|ملاحظتين)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return v
}

function cleanReceiverCandidate(value = '') {
  let v = normalizeArabic(value)

  v = v
    .replace(/\b(الجهه|الجهة|المرسل|اليها|إليها|الشركه|الشركة|المخول|المدخول|حول|ناقل|اهلي)\b/g, ' ')
    .replace(/\b\d{1,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const replacements = [
    ['النفط ال ذهبي', 'النفط الذهبي'],
    ['الذ هبي', 'الذهبي'],
    ['الذه بي', 'الذهبي'],
    ['الدهبي', 'الذهبي'],
    ['الزهبي', 'الذهبي'],
    ['مصفي', 'مصفى'],
    ['مصفاه', 'مصفاة'],
    ['لانتاج الاسفلت', 'لانتاج الاسفلت'],
    ['الاسفلت المؤكسد', 'الاسفلت المؤكسد'],
    ['الاسفلت المؤكسسد', 'الاسفلت المؤكسد'],
  ]

  for (const [from, to] of replacements) {
    v = v.replaceAll(from, to)
  }

  return v.replace(/\s+/g, ' ').trim()
}

function buildTextCandidates(rawGroup = [], type = 'generic') {
  const seed = uniqCandidateValues(rawGroup)
  const out = []
  const seen = new Set()

  const add = (value) => {
    const key = String(value || '').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  }

  for (const item of seed) {
    add(item)

    for (const fragment of splitRawFragments(item)) {
      add(fragment)

      if (type === 'warehouse') {
        add(cleanWarehouseCandidate(fragment))
      } else if (type === 'driver') {
        add(cleanDriverCandidate(fragment))
      } else if (type === 'receiver') {
        add(cleanReceiverCandidate(fragment))
      } else {
        add(removeCommonNoise(fragment))
      }
    }

    if (type === 'warehouse') {
      add(cleanWarehouseCandidate(item))
    } else if (type === 'driver') {
      add(cleanDriverCandidate(item))
    } else if (type === 'receiver') {
      add(cleanReceiverCandidate(item))
    } else {
      add(removeCommonNoise(item))
    }
  }

  return out.filter(Boolean)
}

function scoreDriverCandidateAgainstDb(candidate = '', dbValue = '') {
  const candNorm = cleanDriverCandidate(candidate)
  const dbNorm = normalizeArabic(dbValue)

  if (!candNorm || !dbNorm) return 0

  let score =
    (similarity(candNorm, dbNorm) * 0.65) +
    (tokenOverlapScore(candNorm, dbNorm) * 0.35)

  if (candNorm === dbNorm) score = 1
  else if (dbNorm.includes(candNorm) || candNorm.includes(dbNorm)) {
    score = Math.max(score, 0.93)
  }

  const parts = candNorm.split(' ').filter(Boolean)
  if (parts.length < 3) score -= 0.08
  if (parts.length > 6) score -= 0.05
  if (/[0-9]/.test(candidate)) score -= 0.08

  return Math.max(0, Math.min(1, score))
}

function scoreWarehouseCandidateAgainstDb(candidate = '', dbValue = '') {
  const candNorm = cleanWarehouseCandidate(candidate)
  const dbNorm = normalizeArabic(dbValue)

  if (!candNorm || !dbNorm) return 0

  let score =
    (similarity(candNorm, dbNorm) * 0.55) +
    (tokenOverlapScore(candNorm, dbNorm) * 0.45)

  if (candNorm === dbNorm) score = 1
  else if (dbNorm.includes(candNorm) || candNorm.includes(dbNorm)) {
    score = Math.max(score, 0.94)
  }

  if (candNorm.includes('مستودع')) score += 0.03
  if (!candNorm.includes('مستودع') && dbNorm.includes('مستودع')) score -= 0.06
  if (candNorm.split(' ').length > 6) score -= 0.05

  return Math.max(0, Math.min(1, score))
}

function scoreVehicleCandidateAgainstDb(candidate = '', dbVehicleNumber = '', dbGovernorate = '', ocrGovernorate = '') {
  const candStd = standardizeVehicleNumber(candidate)
  const dbStd = standardizeVehicleNumber(dbVehicleNumber)

  if (!candStd || !dbStd) return 0

  let numberScore = similarity(candStd, dbStd)

  if (candStd === dbStd) {
    numberScore = 1
  } else if (dbStd.includes(candStd) || candStd.includes(dbStd)) {
    numberScore = Math.max(numberScore, 0.94)
  }

  let finalScore = numberScore

  if (ocrGovernorate && dbGovernorate) {
    const govScore = similarity(
      normalizeArabic(ocrGovernorate),
      normalizeArabic(dbGovernorate)
    )
    finalScore = (numberScore * 0.88) + (govScore * 0.12)
  }

  return Math.max(0, Math.min(1, finalScore))
}

function scoreReceiverCandidateAgainstCanonical(candidate = '', canonicalValue = '') {
  const candNorm = cleanReceiverCandidate(candidate)
  const dbNorm = cleanReceiverCandidate(canonicalValue)

  if (!candNorm || !dbNorm) return 0

  let score =
    (similarity(candNorm, dbNorm) * 0.45) +
    (tokenOverlapScore(candNorm, dbNorm) * 0.55)

  if (candNorm === dbNorm) score = 1
  else if (candNorm.includes(dbNorm) || dbNorm.includes(candNorm)) {
    score = Math.max(score, 0.95)
  }

  if (candNorm.includes('النفط') && dbNorm.includes('النفط')) score += 0.02
  if (candNorm.includes('الذهبي') && dbNorm.includes('الذهبي')) score += 0.02
  if (candNorm.includes('الاسفلت') && dbNorm.includes('الاسفلت')) score += 0.02
  if (candNorm.includes('المؤكسد') && dbNorm.includes('المؤكسد')) score += 0.02

  return Math.max(0, Math.min(1, score))
}

async function matchDriverFromOcr(ocrDriver = {}) {
  const candidateValues = buildTextCandidates([
    ocrDriver.bestValue,
    ...(ocrDriver.candidates || []),
    ocrDriver.raw,
  ], 'driver')

  const drivers = await Driver.find({}, { name: 1 }).lean()

  let best = null

  for (const driver of drivers) {
    for (const candidate of candidateValues) {
      const score = scoreDriverCandidateAgainstDb(candidate, driver.name)
      if (!score) continue

      if (!best || score > best.score) {
        best = {
          id: driver._id,
          name: driver.name,
          score: Number(score.toFixed(3)),
          sourceValue: candidate,
        }
      }
    }
  }

  return {
    matched: !!best,
    confidence: best?.score || 0,
    selected: best || null,
    requiresReview: !best || best.score < 0.84,
  }
}

async function matchWarehouseFromOcr(ocrWarehouse = {}) {
  const candidateValues = buildTextCandidates([
    ocrWarehouse.bestValue,
    ...(ocrWarehouse.candidates || []),
    ocrWarehouse.raw,
  ], 'warehouse')

  const warehouses = await LoadingWarehouse.find({}, { name: 1, governorate: 1 }).lean()

  let best = null

  for (const warehouse of warehouses) {
    for (const candidate of candidateValues) {
      const score = scoreWarehouseCandidateAgainstDb(candidate, warehouse.name)
      if (!score) continue

      if (!best || score > best.score) {
        best = {
          id: warehouse._id,
          name: warehouse.name,
          governorate: warehouse.governorate,
          score: Number(score.toFixed(3)),
          sourceValue: candidate,
        }
      }
    }
  }

  return {
    matched: !!best,
    confidence: best?.score || 0,
    selected: best || null,
    requiresReview: !best || best.score < 0.84,
  }
}

async function matchVehicleFromOcr(ocrVehicle = {}) {
  const candidateValues = uniqCandidateValues([
    ocrVehicle.bestValue,
    ...(ocrVehicle.candidates || []),
    ocrVehicle.raw,
    ocrVehicle.normalizedValue,
  ])

  const expandedCandidates = []
  const seen = new Set()

  for (const candidate of candidateValues) {
    const variants = [
      candidate,
      normalizeVehicleText(candidate),
      standardizeVehicleNumber(candidate),
    ]

    for (const v of variants) {
      const key = String(v || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      expandedCandidates.push(key)
    }
  }

  const vehicles = await Vehicle.find({}, { vehicleNumber: 1, governorate: 1 }).lean()

  let best = null

  for (const vehicle of vehicles) {
    for (const candidate of expandedCandidates) {
      const score = scoreVehicleCandidateAgainstDb(
        candidate,
        vehicle.vehicleNumber,
        vehicle.governorate,
        ocrVehicle.governorate
      )

      if (!score) continue

      if (!best || score > best.score) {
        best = {
          id: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          governorate: vehicle.governorate,
          score: Number(score.toFixed(3)),
          sourceValue: candidate,
        }
      }
    }
  }

  return {
    matched: !!best,
    confidence: best?.score || 0,
    selected: best || null,
    requiresReview: !best || best.score < 0.84,
  }
}

function matchReceiverFromOcr(receiverValue = '') {
  const candidateValues = buildTextCandidates([receiverValue], 'receiver')

  let best = null

  for (const canonical of CANONICAL_RECEIVER_ENTITIES) {
    for (const candidate of candidateValues) {
      const score = scoreReceiverCandidateAgainstCanonical(candidate, canonical)
      if (!score) continue

      if (!best || score > best.score) {
        best = {
          name: canonical,
          score: Number(score.toFixed(3)),
          sourceValue: candidate,
        }
      }
    }
  }

  return {
    matched: !!best,
    confidence: best?.score || 0,
    selected: best || null,
    requiresReview: !best || best.score < 0.8,
  }
}

async function resolveUnloadingEntitiesFromOcr(ocrResult = {}) {
  const ocrMatches = ocrResult.ocrMatches || {}

  const [driverMatch, vehicleMatch, warehouseMatch] = await Promise.all([
    matchDriverFromOcr(ocrMatches.driver || {}),
    matchVehicleFromOcr(ocrMatches.vehicle || {}),
    matchWarehouseFromOcr(ocrMatches.loadingWarehouse || {}),
  ])

  const receiverMatch = matchReceiverFromOcr(ocrResult.receiverEntity || '')

  return {
    driverMatch,
    vehicleMatch,
    warehouseMatch,
    receiverMatch,
  }
}

module.exports = {
  CANONICAL_RECEIVER_ENTITIES,
  normalizeArabic,
  normalizeVehicleText,
  standardizeVehicleNumber,
  similarity,
  matchDriverFromOcr,
  matchVehicleFromOcr,
  matchWarehouseFromOcr,
  matchReceiverFromOcr,
  resolveUnloadingEntitiesFromOcr,
}