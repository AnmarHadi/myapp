import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { scanDocumentImage, getScannerErrorMessage, testTwainScanner } from '../utils/scanner'
import ScannerDevicesInfo from '../components/ScannerDevicesInfo'

const getImageUrl = (file) => {
  if (!file) return ''
  if (typeof file === 'string') return file
  return URL.createObjectURL(file)
}

const buildReferenceSvg = (kind, title, subtitle) => {
  const accent = kind === 'loading' ? '#0ea5e9' : '#6366f1'
  const accentSoft = kind === 'loading' ? '#e0f2fe' : '#e0e7ff'
  const documentLines = kind === 'loading'
    ? [
        ['الجهة المجهزة', 'مصفاة النفط الذهبي / شركة الشبكة الذهبية'],
        ['الجهة المرسل إليها', 'المنفذ الجنوبي البحري'],
        ['رقم المركبة', '21H51624'],
      ]
    : [
        ['الجهة المجهزة', 'جهة مجهزة مختلفة'],
        ['الجهة المرسل إليها', 'حسب بيانات التفريغ'],
        ['رقم المركبة', 'A11735023'],
      ]

  const rows = documentLines
    .map((row, index) => {
      const y = 124 + index * 54
      return `
        <g>
          <rect x="48" y="${y - 24}" width="560" height="38" rx="12" fill="#ffffff" stroke="${accentSoft}" />
          <text x="72" y="${y}" fill="#0f172a" font-size="18" font-family="Arial, sans-serif" font-weight="700">${row[0]}</text>
          <text x="372" y="${y}" fill="${accent}" font-size="16" font-family="Arial, sans-serif" font-weight="700" text-anchor="end">${row[1]}</text>
        </g>
      `
    })
    .join('')

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="820" height="340" viewBox="0 0 820 340">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="${accentSoft}" />
        </linearGradient>
      </defs>
      <rect width="820" height="340" rx="28" fill="url(#bg)" />
      <rect x="28" y="28" width="764" height="284" rx="22" fill="#fff" stroke="${accentSoft}" stroke-width="2" />
      <rect x="56" y="52" width="118" height="44" rx="22" fill="${accentSoft}" />
      <text x="115" y="80" fill="${accent}" font-size="18" font-family="Arial, sans-serif" font-weight="700" text-anchor="middle">${kind === 'loading' ? 'تحميل' : 'تفريغ'}</text>
      <text x="620" y="78" fill="#0f172a" font-size="28" font-family="Arial, sans-serif" font-weight="800" text-anchor="end">${title}</text>
      <text x="620" y="108" fill="#475569" font-size="16" font-family="Arial, sans-serif" text-anchor="end">${subtitle}</text>
      ${rows}
      <rect x="48" y="252" width="704" height="38" rx="12" fill="${accentSoft}" />
      <text x="728" y="277" fill="#0f172a" font-size="15" font-family="Arial, sans-serif" text-anchor="end">صورة مرجعية خاصة بهذا المسار فقط</text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const normalizeReceiverSearchText = (value = '') =>
  String(value || '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FF0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isReceiverAccepted = (value = '') => {
  const raw = String(value || '')
  const normalized = normalizeReceiverSearchText(raw)

  const directPatterns = [
    /مصفى\s*النفط\s*الذهبي/,
    /مصفاة\s*النفط\s*الذهبي/,
    /مصفي\s*النفط\s*الذهبي/,
    /مصفاه\s*النفط\s*الذهبي/,
  ]

  if (directPatterns.some((pattern) => pattern.test(raw))) {
    return true
  }

  const normalizedPatterns = [
    /مصفي\s*النفط\s*الذهبي/,
    /مصفاه\s*النفط\s*الذهبي/,
  ]

  if (normalizedPatterns.some((pattern) => pattern.test(normalized))) {
    return true
  }

  const hasOilSignal = normalized.includes(normalizeReceiverSearchText('النفط'))
  const hasGoldenSignal = [
    'الذهبي',
    'الذهبية',
    'الذهبيه',
    'الذهبى',
    'الذهب',
  ].some((token) => normalized.includes(normalizeReceiverSearchText(token)))
  const hasReceiverContextSignal = [
    'مصفى',
    'مصفاة',
    'معمل',
    'م. النفط',
    'الشبكة',
    'القابضة',
    'القابضه',
  ].some((token) => normalized.includes(normalizeReceiverSearchText(token)))

  return hasOilSignal && hasGoldenSignal && hasReceiverContextSignal
}

const isAllowedLoadingWarehouse = (value = '') => {
  const normalized = normalizeReceiverSearchText(value)
  return /(?:مصفى|مصفاة)\s*النفط\s*الذهبي/.test(normalized)
}

const canonicalizeLoadingWarehouseName = (value = '') => {
  const normalized = normalizeReceiverSearchText(value)
  if (!normalized) return ''

  if (
    normalized.includes(normalizeReceiverSearchText('مستودع النجف الجديد')) ||
    (normalized.includes(normalizeReceiverSearchText('مستودع')) && normalized.includes(normalizeReceiverSearchText('النجف')))
  ) {
    return 'مستودع النجف الجديد'
  }

  if (
    normalized.includes(normalizeReceiverSearchText('مستودع الدورة الجديد')) ||
    (normalized.includes(normalizeReceiverSearchText('مستودع')) && normalized.includes(normalizeReceiverSearchText('الدورة')))
  ) {
    return 'مستودع الدورة الجديد'
  }

  if (
    normalized.includes(normalizeReceiverSearchText('شركة الشبكة الذهبية القابضة')) ||
    normalized.includes(normalizeReceiverSearchText('الشبكة الذهبية القابضة'))
  ) {
    return 'شركة الشبكة الذهبية القابضة'
  }

  if (
    normalized.includes(normalizeReceiverSearchText('شركة الشبكة الذهبية')) ||
    normalized.includes(normalizeReceiverSearchText('الشبكة الذهبية'))
  ) {
    return 'شركة الشبكة الذهبية'
  }

  if (
    normalized.includes(normalizeReceiverSearchText('مصفى النفط الذهبي')) ||
    normalized.includes(normalizeReceiverSearchText('مصفاة النفط الذهبي')) ||
    normalized.includes(normalizeReceiverSearchText('معمل مصفى النفط الذهبي')) ||
    normalized.includes(normalizeReceiverSearchText('معمل مصفاة النفط الذهبي')) ||
    (normalized.includes(normalizeReceiverSearchText('مصفى')) && normalized.includes(normalizeReceiverSearchText('النفط')) && normalized.includes(normalizeReceiverSearchText('الذهبي'))) ||
    (normalized.includes(normalizeReceiverSearchText('مصفاة')) && normalized.includes(normalizeReceiverSearchText('النفط')) && normalized.includes(normalizeReceiverSearchText('الذهبي')))
  ) {
    return 'مصفى النفط الذهبي'
  }

  return normalized
}

const normalizeDriverCompareText = (value = '') =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const isMinorDriverNameDifference = (finalName = '', ocrName = '') => {
  const finalNormalized = normalizeDriverCompareText(finalName)
  const ocrNormalized = normalizeDriverCompareText(ocrName)

  if (!finalNormalized || !ocrNormalized) return false
  if (finalNormalized === ocrNormalized) return true
  if (finalNormalized.includes(ocrNormalized) || ocrNormalized.includes(finalNormalized)) return true

  const finalParts = finalNormalized.split(' ').filter(Boolean)
  const ocrParts = ocrNormalized.split(' ').filter(Boolean)
  if (!finalParts.length || !ocrParts.length) return false

  const ocrIsSubset = ocrParts.every((part) => finalParts.includes(part))
  const finalIsSubset = finalParts.every((part) => ocrParts.includes(part))
  return ocrIsSubset || finalIsSubset
}

const CRITICAL_STRICT_FIELDS = ['vehicleNumber', 'driverName', 'loadingWarehouseName']
const VEHICLE_PATTERN = /^(?:\d{2}[A-Z]\d{4,6}|[\u0621-\u064A]\d{4,6}(?:\/[\u0600-\u06FF\s]+)?)$/

const STRICT_REASON_LABELS = {
  strict_check_missing: 'نتيجة التحقق الصارم غير موجودة',
  strict_check_not_confirmed: 'الحقل غير مؤكّد',
  vehicle_missing: 'رقم المركبة غير مستخرج',
  vehicle_pattern_invalid: 'صيغة رقم المركبة غير صحيحة',
  vehicle_low_confidence: 'ثقة OCR لرقم المركبة منخفضة',
  vehicle_not_mapped_db: 'رقم المركبة غير مطابق لقاعدة البيانات',
  vehicle_db_mismatch: 'رقم المركبة لا يطابق المركبة المحددة',
  vision_disagreement: 'عدم تطابق بين القراءة الذكية و OCR',
  cross_line_pollution: 'تم رصد تلوث من سطر مجاور',
  driver_missing: 'اسم السائق غير مستخرج',
  driver_name_too_short: 'اسم السائق قصير وغير كاف',
  driver_low_confidence: 'ثقة OCR لاسم السائق منخفضة',
  driver_not_mapped_db: 'اسم السائق غير مطابق لقاعدة البيانات',
  driver_db_mismatch: 'اسم السائق لا يطابق السائق المحدد',
  warehouse_missing: 'مستودع التحميل غير مستخرج',
  warehouse_not_in_whitelist: 'المستودع خارج القائمة المعتمدة',
  warehouse_low_confidence: 'ثقة OCR للمستودع منخفضة',
  warehouse_not_mapped_db: 'المستودع غير مطابق لقاعدة البيانات',
  warehouse_db_mismatch: 'المستودع لا يطابق الجهة المحددة',
}

const toWesternDigits = (value = '') =>
  String(value || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

const canonicalVehicleNumber = (value = '') => {
  const original = String(value || '').replace(/\s+/g, ' ').trim()
  if (!original) return ''

  const arabicMatch =
    original.match(/([\u0621-\u064A])\s*(\d{4,6})(?:\s*\/\s*([\u0600-\u06FF\s]+))?/) ||
    original.match(/(\d{4,6})\s*\/\s*([\u0621-\u064A])(?:\s+([\u0600-\u06FF\s]+))?/)

  if (arabicMatch) {
    const left = arabicMatch[1]
    const mid = arabicMatch[2]
    const right = arabicMatch[3] || ''
    const letter = /[\u0621-\u064A]/.test(left) ? left : mid
    const digits = /^\d{4,6}$/.test(mid) ? mid : left
    const governorate = String(right || '').replace(/\s+/g, ' ').trim()
    const normalizedLetter = ['ا', 'أ', 'إ', 'آ'].includes(letter) ? 'أ' : letter
    return `${normalizedLetter}${digits}${governorate ? `/${governorate}` : ''}`
  }

  const raw = toWesternDigits(original).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9/]/g, '')
  if (!raw) return ''

  const slashDigitsFirst = raw.match(/^(\d{4,6})\/(\d{2}[A-Z])$/)
  if (slashDigitsFirst) return `${slashDigitsFirst[2]}${slashDigitsFirst[1]}`

  const slashPrefixFirst = raw.match(/^(\d{2}[A-Z])\/(\d{4,6})$/)
  if (slashPrefixFirst) return `${slashPrefixFirst[1]}${slashPrefixFirst[2]}`

  const embeddedDigitsFirst = raw.match(/(\d{4,6})\/(\d{2}[A-Z])/)
  if (embeddedDigitsFirst) return `${embeddedDigitsFirst[2]}${embeddedDigitsFirst[1]}`

  const embeddedPrefixFirst = raw.match(/(\d{2}[A-Z])\/(\d{4,6})/)
  if (embeddedPrefixFirst) return `${embeddedPrefixFirst[1]}${embeddedPrefixFirst[2]}`

  return raw.replace(/[^A-Z0-9]/g, '')
}

const normalizeDocumentTypeUi = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const compact = raw
    .replace(/\s+/g, '')
    .replace(/[إأآ]/g, 'ا')
    .toLowerCase()

  if (/^126/.test(compact) && /تصدير/.test(compact)) return '126 تصديري'
  if (/^90$/.test(compact) || /استمارةنقل90/.test(compact)) return '90'
  if (/^68$/.test(compact)) return '68ج'
  if (/^68[ابج]$/.test(compact)) return compact
  if (/^68a$/.test(compact)) return '68ا'
  if (/^68b$/.test(compact)) return '68ب'
  if (/^68c$/.test(compact)) return '68ج'

  return raw
}

const tokenizeArabicDriver = (value = '') =>
  String(value || '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => /^[\u0621-\u064A]{2,}$/.test(token))

const localStrictStatus = (reasonCodes = []) => (reasonCodes.length ? 'review_required' : 'confirmed')

const buildBlockingErrorsFromStrictChecks = (strictChecks = {}) => {
  const blocking = []

  for (const field of CRITICAL_STRICT_FIELDS) {
    const check = strictChecks?.[field]
    if (!check) {
      blocking.push({ field, reasonCode: 'strict_check_missing' })
      continue
    }

    if (check.status !== 'confirmed') {
      const reasons = Array.isArray(check.reasonCodes) && check.reasonCodes.length
        ? check.reasonCodes
        : ['strict_check_not_confirmed']
      reasons.forEach((reasonCode) => blocking.push({ field, reasonCode }))
    }
  }

  return blocking
}

const recomputeStrictChecksAfterEdit = (draft = {}) => {
  const nextChecks = { ...(draft.strictChecks || {}) }

  const vehicleNormalized = canonicalVehicleNumber(draft.vehicleNumber || '')
  const vehicleReasons = []
  if (!vehicleNormalized) vehicleReasons.push('vehicle_missing')
  else if (!VEHICLE_PATTERN.test(vehicleNormalized)) vehicleReasons.push('vehicle_pattern_invalid')

  nextChecks.vehicleNumber = {
    ...(nextChecks.vehicleNumber || {}),
    field: 'vehicleNumber',
    value: draft.vehicleNumber || '',
    normalizedValue: vehicleNormalized,
    reasonCodes: vehicleReasons,
    status: localStrictStatus(vehicleReasons),
  }

  const driverValue = String(draft.driverName || '').replace(/\s+/g, ' ').trim()
  const driverTokens = tokenizeArabicDriver(driverValue)
  const driverReasons = []
  if (!driverValue) driverReasons.push('driver_missing')
  else {
    if (driverTokens.length < 3) driverReasons.push('driver_name_too_short')
    if (/\d/.test(driverValue)) driverReasons.push('cross_line_pollution')
  }
  if (!draft.driverId) driverReasons.push('driver_not_mapped_db')

  nextChecks.driverName = {
    ...(nextChecks.driverName || {}),
    field: 'driverName',
    value: driverValue,
    normalizedValue: driverValue,
    reasonCodes: driverReasons,
    status: localStrictStatus(driverReasons),
  }

  const warehouseValue = String(draft.loadingWarehouseName || '').replace(/\s+/g, ' ').trim()
  const warehouseReasons = []
  if (!warehouseValue) warehouseReasons.push('warehouse_missing')
  if (!draft.loadingWarehouseId) warehouseReasons.push('warehouse_not_mapped_db')

  nextChecks.loadingWarehouseName = {
    ...(nextChecks.loadingWarehouseName || {}),
    field: 'loadingWarehouseName',
    value: warehouseValue,
    normalizedValue: warehouseValue,
    reasonCodes: warehouseReasons,
    status: localStrictStatus(warehouseReasons),
  }

  return nextChecks
}

const emptyForm = {
  documentNumber: '',
  documentType: '',
  productType: '',
  loadingWarehouseId: '',
  loadingWarehouseName: '',
  loadingWarehouseOcr: '',
  receiverEntity: '',
  receiverEntityOcr: '',
  receiverEntityWarning: '',
  vehicleId: '',
  vehicleNumber: '',
  vehicleNumberOcr: '',
  vehicleMatchSource: '',
  warehouseMatchSource: '',
  driverId: '',
  driverName: '',
  driverNameOcr: '',
  driverMatchSource: '',
  suppliedQuantityLiters: '',
  issueDate: '',
  rawText: '',
  warnings: [],
  validations: {},
  strictChecks: {},
  blockingErrors: [],
  canSave: false,
  extractionSource: {
    mode: '',
    ocrUsed: false,
    visionUsed: false,
    visionBestAttempt: 0,
    visionAttempts: [],
    ocrMode: '',
    ocrAttempts: [],
    ocrBestAttempt: 0,
    ocrDurationMs: 0,
    forceOcr: false,
  },
  visionReview: { available: false, success: false, fields: {}, model: '' },
}

export default function UnloadingRegistration({ registrationMode = 'unloading' } = {}) {
  const isLoadingMode = registrationMode === 'loading'
  const apiBase = isLoadingMode ? '/api/loading-records' : '/api/unloading-records'
  const pageTitle = isLoadingMode ? 'تسجيل التحميل' : 'تسجيل التفريغ'
  const pageKicker = isLoadingMode ? '🧾 تسجيل التحميل' : '🧾 تسجيل التفريغ'
  const receiptTitle = isLoadingMode ? 'وصل تسجيل التحميل' : 'وصل تسجيل التفريغ'
  const recentLabel = isLoadingMode ? 'recent-loading-documents' : 'recent-unloading-documents'
  const referenceImageUrl = buildReferenceSvg(
    registrationMode,
    isLoadingMode ? 'مستند التحميل' : 'مستند التفريغ',
    isLoadingMode ? 'الجهة المجهزة والجهة المرسل إليها والمنتوج' : 'بيانات التفريغ الأساسية'
  )

  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(referenceImageUrl)
  const [extracting, setExtracting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [testingTwain, setTestingTwain] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState(emptyForm)
  const [apiError, setApiError] = useState('')
  const [apiSuccess, setApiSuccess] = useState('')
  const [receipt, setReceipt] = useState(null)

  const [recentReceipts, setRecentReceipts] = useState([])
  const [receiptSearch, setReceiptSearch] = useState('')
  const [selectedRecentReceipt, setSelectedRecentReceipt] = useState(null)
  const [loadingRecentReceipts, setLoadingRecentReceipts] = useState(false)

  // Live search states
  const [driverSearchResults, setDriverSearchResults] = useState([])
  const [vehicleSearchResults, setVehicleSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [loadingWarehouseDbNames, setLoadingWarehouseDbNames] = useState([])

  const shouldResetAfterPrintRef = useRef(false)

  const token = localStorage.getItem('token')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const resetAll = () => {
    setImage(null)
    setPreview(referenceImageUrl)
    setForm(emptyForm)
    setApiError('')
    setApiSuccess('')
    setReceipt(null)
  }

  const loadRecentReceipts = async () => {
    try {
      setLoadingRecentReceipts(true)

      const { data } = await axios.get(`${apiBase}/recent-receipts`, { headers })

      const rows = Array.isArray(data?.data) ? data.data : []
      setRecentReceipts(rows)
    } catch (err) {
      console.error('loadRecentReceipts:', err)
    } finally {
      setLoadingRecentReceipts(false)
    }
  }

  const loadLoadingWarehouseNames = async () => {
    if (!isLoadingMode) {
      setLoadingWarehouseDbNames([])
      return
    }

    try {
      const { data } = await axios.get('/api/loading-warehouses', { headers })
      const rows = Array.isArray(data) ? data : []
      setLoadingWarehouseDbNames(
        rows.map((item) => String(item?.name || '').trim()).filter(Boolean)
      )
    } catch (err) {
      console.error('loadLoadingWarehouseNames:', err)
      setLoadingWarehouseDbNames([])
    }
  }

  useEffect(() => {
    loadRecentReceipts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadLoadingWarehouseNames()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingMode])

  useEffect(() => {
    const handleAfterPrint = () => {
      if (shouldResetAfterPrintRef.current) {
        shouldResetAfterPrintRef.current = false
        resetAll()
      }
    }

    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  useEffect(() => {
    const normalized = String(receiptSearch || '').trim()
    if (!normalized) {
      setSelectedRecentReceipt(null)
      return
    }

    const found = recentReceipts.find(
      (item) => String(item.documentNumber || '').trim() === normalized
    )

    setSelectedRecentReceipt(found || null)
  }, [receiptSearch, recentReceipts])

  const handleImageChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImage(file)
    setPreview(getImageUrl(file))
    setApiError('')
    setApiSuccess('')
    setReceipt(null)
    setForm(emptyForm)
  }

const isReceiverEntityInLoadingDb = (value = '') => {
  if (!isLoadingMode) return isReceiverAccepted(value)
  const normalized = canonicalizeLoadingWarehouseName(value)
  if (!normalized) return false

  return loadingWarehouseDbNames.some((name) => {
      const candidate = canonicalizeLoadingWarehouseName(name)
      return candidate && (normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized))
    })
  }

  const handleScanFromScanner = async () => {
    setApiError('')
    setApiSuccess('')
    setScanning(true)

    try {
      const { file } = await scanDocumentImage(token, { mode: 'accurate' })
      setImage(file)
      setPreview(getImageUrl(file))
      setReceipt(null)
      setForm(emptyForm)
    } catch (error) {
      setApiError(getScannerErrorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  const handleTestTwain = async () => {
    setApiError('')
    setApiSuccess('')
    setTestingTwain(true)

    try {
      const token = localStorage.getItem('token') || ''
      const result = await testTwainScanner(token)
      setApiSuccess(result.message)
    } catch (error) {
      setApiError(getScannerErrorMessage(error))
    } finally {
      setTestingTwain(false)
    }
  }

  const applyExtractedForm = (extracted) => {
    setForm({
      documentNumber: extracted.documentNumber || '',
      documentType: normalizeDocumentTypeUi(extracted.documentType || ''),
      productType: extracted.productType || '',
      loadingWarehouseId: extracted.loadingWarehouseId || '',
      loadingWarehouseName: extracted.loadingWarehouseName || '',
      loadingWarehouseOcr: extracted.loadingWarehouseOcr || '',
      receiverEntity: extracted.receiverEntity || '',
      receiverEntityOcr: extracted.receiverEntityOcr || '',
      receiverEntityWarning: extracted.receiverEntityWarning || '',
      vehicleId: extracted.vehicleId || '',
      vehicleNumber: extracted.vehicleNumber || '',
      vehicleNumberOcr: extracted.vehicleNumberOcr || '',
      vehicleMatchSource: extracted.vehicleMatchSource || '',
      warehouseMatchSource: extracted.warehouseMatchSource || '',
      driverId: extracted.driverId || '',
      driverName: extracted.driverName || '',
      driverNameOcr: extracted.driverNameOcr || '',
      driverMatchSource: extracted.driverMatchSource || '',
      suppliedQuantityLiters: extracted.suppliedQuantityLiters || '',
      issueDate: extracted.issueDate || '',
      rawText: extracted.rawText || '',
      warnings: extracted.warnings || [],
      validations: extracted.validations || {},
      strictChecks: extracted.strictChecks || {},
      blockingErrors: extracted.blockingErrors || [],
      canSave: Boolean(extracted.canSave),
      extractionSource: extracted.extractionSource || emptyForm.extractionSource,
      visionReview: extracted.visionReview || emptyForm.visionReview,
    })
  }

  const handleExtract = async (options = {}) => {
    if (!image) {
      setApiError('يرجى اختيار صورة المستند أولاً')
      return
    }

    setExtracting(true)
    setApiError('')
    setApiSuccess('')
    setReceipt(null)

    try {
      const fd = new FormData()
      fd.append('image', image)
      if (options.ocrMode) fd.append('ocrMode', options.ocrMode)
      if (options.forceOcr) fd.append('forceOcr', '1')

      fd.append('registrationMode', registrationMode)

      const { data } = await axios.post(`${apiBase}/extract`, fd, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
      })

      if (!data?.success || !data?.data) {
        setApiError(data?.message || 'تعذر استخراج البيانات')
        return
      }

      const extracted = data.data

      applyExtractedForm(extracted)

      setApiSuccess(data?.message || 'تمت قراءة المستند. راجع البيانات قبل الحفظ.')
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في قراءة المستند')
    } finally {
      setExtracting(false)
    }
  }

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (form.driverName.trim().length >= 2) {
        searchDrivers(form.driverName)
      } else {
        setDriverSearchResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [form.driverName])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (form.vehicleNumber.trim().length >= 2) {
        searchVehicles(form.vehicleNumber)
      } else {
        setVehicleSearchResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [form.vehicleNumber])

  const searchDrivers = async (query) => {
    if (query.length < 2) return
    setSearchLoading(true)
    try {
      const { data } = await axios.post('/api/drivers/search', { q: query, limit: 5 }, { headers })
      setDriverSearchResults(data)
    } catch {
      setDriverSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  const searchVehicles = async (query) => {
    if (query.length < 2) return
    setSearchLoading(true)
    try {
      const { data } = await axios.post('/api/vehicles/search', { q: query, limit: 5 }, { headers })
      setVehicleSearchResults(data)
    } catch {
      setVehicleSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  const selectDriver = (driver) => {
    setForm(prev => ({
      ...prev,
      driverName: driver.name,
      driverId: driver._id,
      driverMatchSource: 'manual_search'
    }))
    setDriverSearchResults([])
  }

  const selectVehicle = (vehicle) => {
    setForm(prev => ({
      ...prev,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleId: vehicle._id,
      vehicleMatchSource: 'manual_search'
    }))
    setVehicleSearchResults([])
  }

  const handleChange = (e) => {
    const { name } = e.target
    const value = name === 'documentType'
      ? normalizeDocumentTypeUi(e.target.value)
      : e.target.value

    setForm((prev) => {
      const next = {
        ...prev,
        [name]: value,
        ...(name === 'driverName' || name === 'vehicleNumber' ? { [name === 'driverName' ? 'driverId' : 'vehicleId']: '' } : {} )
      }

      if (name === 'receiverEntity') {
        const isValid = isReceiverEntityInLoadingDb(value)
        next.receiverEntityWarning = !isValid && value
          ? (isLoadingMode
            ? 'الجهة المرسل إليها يجب أن تطابق قاعدة بيانات جهات التحميل'
            : 'الجهة المرسل إليها غير صحيحة')
          : ''
        next.validations = {
          ...prev.validations,
          receiverEntityValid: isValid,
        }
      }

      if (CRITICAL_STRICT_FIELDS.includes(name)) {
        next.strictChecks = recomputeStrictChecksAfterEdit(next)
        next.blockingErrors = buildBlockingErrorsFromStrictChecks(next.strictChecks)
        next.canSave = next.blockingErrors.length === 0
      }

      return next
    })
  }

  const activeBlockingErrors = Array.isArray(form.blockingErrors) ? form.blockingErrors : []
  const hasStrictBlockers = activeBlockingErrors.length > 0
  const blockingLabel = (reasonCode = '') => STRICT_REASON_LABELS[reasonCode] || reasonCode

  const validateBeforeSave = () => {
    if (hasStrictBlockers) {
      const first = activeBlockingErrors[0]
      return `تعذر الحفظ: ${blockingLabel(first?.reasonCode || 'strict_check_not_confirmed')}`
    }

    if (!form.documentNumber) return 'رقم المستند مطلوب'
    if (!/^[A-Z]\d{8}$/.test(form.documentNumber)) {
      return 'رقم المستند يجب أن يكون حرفاً إنكليزياً يليه 8 أرقام'
    }

    if (!form.documentType) return 'نوع المستند مطلوب'
    if (!form.loadingWarehouseId) return isLoadingMode
      ? 'مستودع التحميل غير مطابق لقاعدة البيانات'
      : 'الجهة المجهزة غير مطابقة لقاعدة البيانات'
    if (isLoadingMode && !isAllowedLoadingWarehouse(form.loadingWarehouseName)) {
      return 'مستودع التحميل يجب أن يكون شركة الشبكة الذهبية أو مصفى النفط الذهبي'
    }
    if (!form.receiverEntity) return 'الجهة المرسل إليها مطلوبة'
    if (!form.vehicleId) return 'المركبة غير مطابقة لقاعدة البيانات'
    if (!form.driverId) return 'السائق غير مطابق لقاعدة البيانات'
    if (!form.suppliedQuantityLiters || Number(form.suppliedQuantityLiters) <= 0) {
      return 'الكمية المجهزة غير صالحة'
    }
    if (!form.issueDate) return 'تاريخ الإصدار مطلوب'

    if (!form.validations?.documentNumberValid) return 'رقم المستند غير صالح'
    if (!form.validations?.documentNumberUnique) return 'رقم المستند موجود مسبقاً'
    if (!form.validations?.receiverEntityValid) {
      return isLoadingMode
        ? 'الجهة المرسل إليها يجب أن تطابق قاعدة بيانات جهات التحميل'
        : 'المستند غير موجه إلى مصفاة النفط الذهبي'
    }
    if (!form.validations?.loadingWarehouseFound) return 'الجهة المجهزة غير موجودة في قاعدة البيانات'
    if (!form.validations?.pricingFound) return 'المحور لم يتم تسعيره'
    if (!form.validations?.driverFound) return 'اسم السائق غير موجود في قاعدة البيانات'

    return ''
  }

  const handleSave = async () => {
    const error = validateBeforeSave()
    if (error) {
      setApiError(error)
      return
    }

    setSaving(true)
    setApiError('')
    setApiSuccess('')

    try {
      const payload = {
        documentNumber: form.documentNumber,
        documentType: form.documentType,
        productType: form.productType,
        loadingWarehouseId: form.loadingWarehouseId,
        loadingWarehouseName: form.loadingWarehouseName,
        receiverEntity: form.receiverEntity,
        registrationMode,
        vehicleId: form.vehicleId,
        vehicleNumber: form.vehicleNumber,
        driverId: form.driverId,
        driverName: form.driverName,
        suppliedQuantityLiters: Number(form.suppliedQuantityLiters),
        issueDate: form.issueDate,
        rawText: form.rawText,
        warnings: form.warnings,
        strictChecks: form.strictChecks || {},
        blockingErrors: form.blockingErrors || [],
      }

      const { data } = await axios.post(`${apiBase}/save`, payload, { headers })

      if (!data?.success) {
        setApiError(data?.message || 'فشل في الحفظ')
        return
      }

      const savedReceipt = data.data?.receipt || null
      setReceipt(savedReceipt)
      setApiSuccess(data?.message || 'تم الحفظ بنجاح')

      await loadRecentReceipts()
    } catch (err) {
      const serverBlockingErrors = err.response?.data?.blockingErrors
      if (Array.isArray(serverBlockingErrors) && serverBlockingErrors.length) {
        setForm((prev) => ({
          ...prev,
          strictChecks: err.response?.data?.strictChecks || prev.strictChecks,
          blockingErrors: serverBlockingErrors,
          canSave: false,
        }))
      }
      setApiError(err.response?.data?.message || 'فشل في الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const printReceipt = () => {
    if (!receipt) return
    shouldResetAfterPrintRef.current = true
    window.print()
  }

  const printSelectedRecentReceipt = () => {
    if (!selectedRecentReceipt) return
    setReceipt(selectedRecentReceipt)
    shouldResetAfterPrintRef.current = false

    setTimeout(() => {
      window.print()
    }, 100)
  }

  const validationRows = [
    ['رقم المستند', form.validations?.documentNumberValid],
    ['رقم المركبة', form.validations?.vehicleNumberValid],
    ...(isLoadingMode ? [['نوع المنتوج', Boolean(form.productType)]] : []),
    ['اسم السائق مرتبط برقم المركبة', form.validations?.driverVehicleLinked ?? form.validations?.vehicleDriverMatches],
    ['عدم تكرار رقم المستند', form.validations?.documentNumberUnique],
    [isLoadingMode ? 'الجهة المرسلة موجودة' : 'الجهة المجهزة موجودة', form.validations?.loadingWarehouseFound],
    ['الجهة المرسل إليها صحيحة', form.validations?.receiverEntityValid],
    ['اسم السائق موجود', form.validations?.driverFound],
    ['التحقق الصارم للحقول الحرجة', !hasStrictBlockers],
  ]

  const showDriverOcrNote =
    normalizeDriverCompareText(form.driverNameOcr) &&
    !isMinorDriverNameDifference(form.driverName, form.driverNameOcr)

  const driverMatchSourceLabel =
    form.driverMatchSource === 'vehicle_linked_driver'
      ? 'تم اعتماد الاسم من السائق المرتبط بالمركبة'
      : form.driverMatchSource === 'database_fuzzy'
        ? 'تم اعتماد الاسم من قاعدة البيانات'
        : form.driverMatchSource === 'vision_first'
          ? 'تم اعتماد الاسم من المراجعة الذكية'
          : ''

  const vehicleMatchSourceLabel =
    form.vehicleMatchSource === 'database'
      ? 'تم اعتماد رقم المركبة من قاعدة البيانات'
      : form.vehicleMatchSource === 'vision_first'
        ? 'تم اعتماد رقم المركبة من المراجعة الذكية'
        : ''

  const warehouseMatchSourceLabel =
    form.warehouseMatchSource === 'database'
      ? (isLoadingMode ? 'تم اعتماد الجهة المرسلة من قاعدة البيانات' : 'تم اعتماد الجهة المجهزة من قاعدة البيانات')
      : form.warehouseMatchSource === 'vision_first'
        ? (isLoadingMode ? 'تم اعتماد الجهة المرسلة من المراجعة الذكية' : 'تم اعتماد الجهة المجهزة من المراجعة الذكية')
        : ''

  const extractionModeLabel =
    form.extractionSource?.mode === 'google_document_ai_only'
      ? 'Google Document AI'
      : form.extractionSource?.mode === 'google_document_ai_with_ocr_fallback'
        ? 'Google ثم OCR'
        : form.extractionSource?.mode === 'openai_document_ai_only'
          ? 'OpenAI Document AI'
          : form.extractionSource?.mode === 'openai_document_ai_with_ocr_fallback'
            ? 'OpenAI ثم OCR'
            : form.extractionSource?.mode === 'gemini_document_ai_only'
              ? 'Gemini Document AI'
              : form.extractionSource?.mode === 'gemini_document_ai_with_ocr_fallback'
                ? 'Gemini ثم OCR'
                : form.extractionSource?.mode === 'document_ai_only'
                  ? 'Groq Document AI'
                    : form.extractionSource?.mode === 'document_ai_with_ocr_fallback'
                      ? 'Groq ثم OCR'
                      : form.extractionSource?.mode === 'vision_only'
                        ? 'Vision فقط'
                        : form.extractionSource?.mode === 'vision_first_with_ocr_fallback'
                          ? 'Vision ثم OCR'
                          : form.extractionSource?.mode?.startsWith('vision_optional_')
                            ? 'Vision ثم OCR'
                          : form.extractionSource?.mode === 'ocr_only'
                            ? 'OCR فقط'
                            : ''

  const ocrModeLabel =
    form.extractionSource?.ocrMode === 'retry_deep'
      ? 'OCR Deep Retry'
      : form.extractionSource?.ocrMode === 'retry_fast'
        ? 'OCR Retry'
        : form.extractionSource?.ocrMode === 'default'
          ? 'OCR Standard'
          : ''

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div>
          <div className="pricing-kicker">{pageKicker}</div>
          <h1 className="pricing-title">{pageTitle}</h1>
          <p className="pricing-subtitle">
            ارفع صورة المستند ليتم استخراج البيانات المطلوبة تلقائياً، ثم راجعها قبل الحفظ. بالنسبة لمستند التفريغ، الجهة المجهزة ممكن تكون مختلفة من وثيقة لأخرى.
          </p>
        </div>
      </div>

      <div className="pricing-reference-card pricing-reference-card-hero" aria-label={isLoadingMode ? 'مستند التحميل المرجعي' : 'مستند التفريغ المرجعي'}>
        <div className="pricing-reference-copy">
          <div className="pricing-section-title">
            {isLoadingMode ? 'مستند التحميل المرجعي' : 'مستند التفريغ المرجعي'}
          </div>
          <p className="pricing-card-subtitle">
            {isLoadingMode
              ? 'هذه الصورة المرجعية خاصة بتسجيل التحميل فقط، وتساعد النظام على تمييز حقول التحميل عن التفريغ.'
              : 'هذه الصورة المرجعية خاصة بتسجيل التفريغ فقط، وتساعد النظام على تمييز حقول التفريغ عن التحميل.'}
          </p>
        </div>

        <div className="pricing-reference-image">
          <img src={referenceImageUrl} alt={isLoadingMode ? 'مستند التحميل' : 'مستند التفريغ'} />
        </div>
      </div>

      <div className="pricing-card pricing-card-upload">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">1. رفع المستند</h2>
            <p className="pricing-card-subtitle">ابدأ من هنا فقط. ارفع ملفًا أو اسحب من السكنر ثم نفذ القراءة.</p>
          </div>
        </div>

        <div className="pricing-toolbar pricing-toolbar-compact">
          <label className="pricing-btn pricing-btn-secondary" style={{ cursor: 'pointer' }}>
            إضافة صورة المستند
            <input type="file" accept="image/*" onChange={handleImageChange} hidden />
          </label>

          <button
            type="button"
            className="pricing-btn pricing-btn-secondary"
            onClick={handleScanFromScanner}
            disabled={scanning}
          >
            {scanning ? 'جاري السحب...' : 'سحب من السكنر'}
          </button>

          <button
            type="button"
            className="pricing-btn pricing-btn-primary"
            onClick={() => handleExtract()}
            disabled={!image || extracting}
          >
            {extracting ? 'جاري القراءة...' : 'قراءة البيانات'}
          </button>

          <button
            type="button"
            className="pricing-btn pricing-btn-secondary"
            onClick={() => handleExtract({ forceOcr: true, ocrMode: 'retry_fast' })}
            disabled={!image || extracting}
          >
            إعادة OCR
          </button>
        </div>

        <details className="pricing-details-panel no-print">
          <summary>معلومات السكنر</summary>
          <div className="pricing-details-body">
            <ScannerDevicesInfo token={token} />
            <button
              type="button"
              className="pricing-btn pricing-btn-secondary"
              onClick={handleTestTwain}
              disabled={testingTwain}
              style={{ marginTop: 12 }}
            >
              {testingTwain ? 'جارٍ الاختبار...' : 'اختبار TWAIN'}
            </button>
          </div>
        </details>

        {preview && (
          <div className="pricing-preview">
            <img src={preview} alt="preview" />
          </div>
        )}
      </div>

      <div className="pricing-card pricing-card-data">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">2. البيانات المستخرجة</h2>
            <p className="pricing-card-subtitle">الحقول الأساسية أولًا، ثم بقية التفاصيل عند الحاجة فقط.</p>
          </div>
        </div>

        <div className="pricing-form">
          <div className="pricing-section-block">
            <div className="pricing-section-title">بيانات المستند</div>
            <div className="pricing-grid-3">
              <div className="pricing-field">
                <label className="pricing-label">رقم المستند</label>
                <input
                  className="pricing-input"
                  name="documentNumber"
                  value={form.documentNumber}
                  onChange={handleChange}
                  placeholder="A28187153"
                />
              </div>

                <div className="pricing-field">
                  <label className="pricing-label">نوع المستند</label>
                  <input
                    className="pricing-input"
                    name="documentType"
                    value={form.documentType}
                    onChange={handleChange}
                  />
                </div>

              {isLoadingMode && (
                <div className="pricing-field">
                  <label className="pricing-label">نوع المنتوج</label>
                  <input
                    className="pricing-input"
                    name="productType"
                    value={form.productType}
                    onChange={handleChange}
                    placeholder="مثال: زيت الوقود"
                  />
                  <div className="pricing-inline-note">
                    يُقرأ من السطر الموجود تحت عبارة <strong>نوع المنتوج</strong> في مستند التحميل.
                  </div>
                </div>
              )}

              <div className="pricing-field">
                <label className="pricing-label">تاريخ الإصدار</label>
                <input
                  type="date"
                  className="pricing-input"
                  name="issueDate"
                  value={form.issueDate}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>

          <div className="pricing-section-block">
            <div className="pricing-section-title">الجهات الأساسية</div>
            <div className="pricing-grid-2">
              <div className="pricing-field">
                <label className="pricing-label">{isLoadingMode ? 'الجهة المرسلة / مستودع التحميل' : 'الجهة المجهزة / مستودع التحميل'}</label>
                <input
                  className="pricing-input"
                  name="loadingWarehouseName"
                  value={form.loadingWarehouseName}
                  onChange={handleChange}
                />
                {warehouseMatchSourceLabel ? (
                  <div className="pricing-inline-note pricing-inline-note-success">
                    <strong>{warehouseMatchSourceLabel}:</strong> {form.loadingWarehouseName}
                    {form.loadingWarehouseOcr &&
                    normalizeReceiverSearchText(form.loadingWarehouseOcr) !== normalizeReceiverSearchText(form.loadingWarehouseName) ? (
                      <div className="pricing-inline-note-sub">النص المقروء من الصورة: {form.loadingWarehouseOcr}</div>
                    ) : null}
                  </div>
                ) : null}
                    {isLoadingMode ? (
                      <div className="pricing-inline-note">
                    المستودعات المسموح بها: شركة الشبكة الذهبية أو مصفى النفط الذهبي.
                      </div>
                    ) : null}
              </div>

              <div className="pricing-field">
                <label className="pricing-label">الجهة المرسل إليها</label>
                <input
                  className="pricing-input"
                  name="receiverEntity"
                  value={form.receiverEntity}
                  onChange={handleChange}
                />
                {isLoadingMode ? (
                  <div className="pricing-inline-note">
                    جميع جهات التحميل تعتمد من هذا الموضع: السطر العلوي بعد عبارة الجهة المرسل إليها المشتري، ثم تتم مطابقتها مع قاعدة بيانات وجهات التحميل.
                  </div>
                ) : null}
                {form.receiverEntity ? (
                  <div
                    className={`pricing-inline-note ${
                      form.validations?.receiverEntityValid ? 'pricing-inline-note-success' : 'pricing-inline-note-error'
                    }`}
                  >
                    {isLoadingMode ? 'مطابقة مع قاعدة بيانات جهات التحميل: ' : 'الجهة النهائية المعتمدة: '}
                    <strong>{form.receiverEntity}</strong>
                    {form.receiverEntityOcr &&
                    normalizeReceiverSearchText(form.receiverEntityOcr) !== normalizeReceiverSearchText(form.receiverEntity) ? (
                      <div className="pricing-inline-note-sub">النص الخام من الصورة: {form.receiverEntityOcr}</div>
                    ) : null}
                  </div>
                ) : null}
                {form.receiverEntityWarning ? (
                  <div className="pricing-inline-note pricing-inline-note-error">
                    <strong>تنبيه:</strong> {form.receiverEntityWarning}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="pricing-section-block">
            <div className="pricing-section-title">السائق والمركبة</div>
            <div className="pricing-grid-3">
              <div className="pricing-field">
                <label className="pricing-label">رقم المركبة</label>
                <input
                  className="pricing-input"
                  name="vehicleNumber"
                  value={form.vehicleNumber}
                  onChange={handleChange}
                  placeholder="اكتب للبحث في قاعدة المركبات..."
                />
                {vehicleMatchSourceLabel ? (
                  <div className="pricing-inline-note pricing-inline-note-success">
                    <strong>{vehicleMatchSourceLabel}:</strong> {form.vehicleNumber}
                    {form.vehicleNumberOcr &&
                    canonicalVehicleNumber(form.vehicleNumberOcr) !== canonicalVehicleNumber(form.vehicleNumber) ? (
                      <div className="pricing-inline-note-sub">الرقم المقروء من الصورة: {form.vehicleNumberOcr}</div>
                    ) : null}
                  </div>
                ) : null}
                {vehicleSearchResults.length > 0 && (
                  <div className="search-dropdown search-dropdown-wide">
                    {vehicleSearchResults.map((vehicle) => (
                      <div
                        key={vehicle._id}
                        className="search-item"
                        onMouseDown={() => selectVehicle(vehicle)}
                      >
                        <strong>{vehicle.vehicleNumber}</strong>
                        {vehicle.governorate && <span className="search-item-meta"> - {vehicle.governorate}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pricing-field pricing-field-relative">
                <label className="pricing-label">اسم السائق</label>
                <input
                  className="pricing-input"
                  name="driverName"
                  value={form.driverName}
                  onChange={handleChange}
                  placeholder="اكتب للبحث في قاعدة السائقين..."
                />
                {showDriverOcrNote ? (
                  <div className="pricing-inline-note pricing-inline-note-success">
                    <strong>{driverMatchSourceLabel || 'تم اعتماد الاسم المصحح'}:</strong> {form.driverName}
                    <div className="pricing-inline-note-sub">الاسم المقروء من الصورة: {form.driverNameOcr}</div>
                  </div>
                ) : null}
                {driverSearchResults.length > 0 && (
                  <div className="search-dropdown search-dropdown-wide">
                    {driverSearchResults.map((driver) => (
                      <div
                        key={driver._id}
                        className="search-item"
                        onMouseDown={() => selectDriver(driver)}
                      >
                        {driver.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pricing-field">
                <label className="pricing-label">الكمية المجهزة (لتر)</label>
                <input
                  className="pricing-input"
                  name="suppliedQuantityLiters"
                  value={form.suppliedQuantityLiters}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="pricing-modal-footer no-print">
              <button
                type="button"
                className="pricing-btn pricing-btn-primary"
                onClick={handleSave}
                disabled={saving || hasStrictBlockers}
              >
                {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <details className="pricing-details-panel no-print pricing-panel-reprint">
        <summary>إعادة طباعة الوصل</summary>
        <div className="pricing-details-body">
          <p className="pricing-card-subtitle">استخدم هذا القسم فقط إذا احتجت إعادة طباعة وصل سابق.</p>

          <div className="pricing-field" style={{ marginTop: 12 }}>
            <label className="pricing-label">رقم المستند</label>
            <input
              className="pricing-input"
              list={recentLabel}
              value={receiptSearch}
              onChange={(e) => setReceiptSearch(e.target.value)}
              placeholder={loadingRecentReceipts ? 'جاري تحميل الوصلات...' : 'اكتب أو اختر رقم المستند'}
            />
            <datalist id={recentLabel}>
              {recentReceipts.map((item) => (
                <option key={item.id || item.documentNumber} value={item.documentNumber} />
              ))}
            </datalist>
          </div>

          {selectedRecentReceipt ? (
            <div className="pricing-modal-footer no-print">
              <button
                type="button"
                className="pricing-btn pricing-btn-secondary"
                onClick={printSelectedRecentReceipt}
              >
                طباعة الوصل
              </button>
            </div>
          ) : null}
        </div>
      </details>

      {(apiError || apiSuccess) && (
        <div className={`pricing-alert ${apiError ? 'pricing-alert-error' : 'pricing-alert-success'}`}>
          {apiError || apiSuccess}
        </div>
      )}

      {extractionModeLabel && (
        <div className="pricing-status-strip" style={{ marginBottom: 18 }}>
          <strong>محرك الاستخراج:</strong> {extractionModeLabel}
          {form.visionReview?.model ? ` | الموديل: ${form.visionReview.model}` : ''}
          {form.extractionSource?.ocrUsed ? ' | تم استخدام OCR fallback' : ''}
          {form.extractionSource?.visionBestAttempt
            ? ` | أفضل محاولة: ${form.extractionSource.visionBestAttempt}`
            : ''}
          {ocrModeLabel ? ` | وضع OCR: ${ocrModeLabel}` : ''}
          {form.extractionSource?.ocrBestAttempt ? ` | أفضل محاولة OCR: ${form.extractionSource.ocrBestAttempt}` : ''}
          {form.extractionSource?.ocrDurationMs ? ` | زمن OCR: ${Math.round(form.extractionSource.ocrDurationMs / 1000)}s` : ''}
        </div>
      )}

      {hasStrictBlockers && (
        <div className="pricing-alert pricing-alert-error" style={{ marginBottom: 18 }}>
          <strong>مراجعة إلزامية قبل الحفظ:</strong>
          <ul style={{ marginTop: 8, paddingRight: 18 }}>
            {activeBlockingErrors.map((item, index) => (
              <li key={`${item.field || 'field'}-${item.reasonCode || 'reason'}-${index}`}>
                {item.field === 'vehicleNumber'
                  ? 'رقم المركبة'
                  : item.field === 'driverName'
                    ? 'اسم السائق'
                    : item.field === 'loadingWarehouseName'
                      ? 'مستودع التحميل'
                      : 'حقل'}
                : {blockingLabel(item.reasonCode)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="pricing-details-panel no-print pricing-panel-validation">
        <summary>نتائج التحقق</summary>
        <div className="pricing-details-body">
          <div className="pricing-table-wrap">
            <table className="pricing-table pricing-table-validation">
              <colgroup>
                <col style={{ width: '72%' }} />
                <col style={{ width: '28%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>البند</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {validationRows.map(([label, ok]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>
                      {ok ? (
                        <span className="pricing-badge pricing-badge-liter">سليم</span>
                      ) : (
                        <span className="pricing-badge pricing-badge-fixed">غير صالح</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Array.isArray(form.warnings) && form.warnings.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="pricing-alert pricing-alert-error">
                <strong>تحذيرات:</strong>
                <ul style={{ marginTop: 8, paddingRight: 18 }}>
                  {form.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      </details>

      {receipt && (
        <div className="receipt-6cm">
          <div className="receipt-title">{receiptTitle}</div>

          <div className="receipt-row"><strong>رقم المستند:</strong> {receipt.documentNumber}</div>
          <div className="receipt-row"><strong>نوع المستند:</strong> {receipt.documentType}</div>
          {isLoadingMode && (
            <div className="receipt-row"><strong>نوع المنتوج:</strong> {receipt.productType || 'غير محدد'}</div>
          )}
          <div className="receipt-row"><strong>الجهة المجهزة:</strong> {receipt.loadingWarehouse}</div>
          <div className="receipt-row"><strong>الجهة المرسل إليها:</strong> {receipt.receiverEntity}</div>
          <div className="receipt-row"><strong>رقم المركبة:</strong> {receipt.vehicleNumber}</div>
          <div className="receipt-row"><strong>اسم السائق:</strong> {receipt.driverName}</div>
          <div className="receipt-row"><strong>الكمية:</strong> {receipt.suppliedQuantityLiters} لتر</div>
          <div className="receipt-row"><strong>تاريخ الإصدار:</strong> {String(receipt.issueDate).slice(0, 10)}</div>

          <div className="receipt-row">
            <strong>نوع التسعير:</strong> {receipt.pricingType === 'liter' ? 'حسب اللتر' : 'سعر ثابت'}
          </div>

          {receipt.pricingType === 'liter' && (
            <div className="receipt-row">
              <strong>سعر اللتر:</strong> {receipt.priceValue || 0} د.ع
            </div>
          )}

          <div className="receipt-row">
            <strong>مبلغ النقلة:</strong> {receipt.tripAmount || 0} د.ع
          </div>

          {Number(receipt.advanceAmount || 0) > 0 ? (
            <div className="receipt-row">
              <strong>مبلغ السلفة:</strong> {receipt.advanceAmount} د.ع
            </div>
          ) : (
            <div className="receipt-row">
              <strong>المبلغ الكلي للنقلة:</strong> {receipt.tripAmount || 0} د.ع
            </div>
          )}

          <div className="receipt-row">
            <strong>المبلغ الظاهر في الوصل:</strong> {receipt.payableAmount || 0} د.ع
          </div>

          {receipt.qrCodeDataUrl && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <img src={receipt.qrCodeDataUrl} alt="QR" style={{ width: 120, height: 120 }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

