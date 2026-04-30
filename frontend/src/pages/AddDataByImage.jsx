import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { scanDocumentImage, getScannerErrorMessage, testTwainScanner } from '../utils/scanner'
import ScannerDevicesInfo from '../components/ScannerDevicesInfo'

const GOVERNORATES = [
  'بغداد', 'بصرة', 'نينوى', 'أربيل', 'كركوك', 'أنبار', 'بابل', 'ديالى', 'ذي قار', 'دهوك',
  'سليمانية', 'صلاح الدين', 'واسط', 'ميسان', 'مثنى', 'نجف', 'كربلاء', 'قادسية',
]

const initialForm = {
  driverName: '',
  motherName: '',
  birthDate: '',
  nationalId: '',
  address: '',
  vehicleNumber: '',
  governorate: '',
  vehicleTypeName: '',
  ownerName: '',
  annualExpiry: '',
  rawText: '',
}

function extractVehicleNumberSmart(text = '') {
  if (!text) return ''

  const normalized = text
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, '')
    .toUpperCase()

  const patterns = [
    /\d{2,6}\/\d{2}[A-Z]/,
    /\d{2}[A-Z]\d{4,6}/,
    /\d{4,6}[A-Z]/,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match) return match[0]
  }

  return ''
}

function toWesternDigits(value = '') {
  const map = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }
  return String(value).replace(/[٠-٩]/g, (d) => map[d] || d)
}

function cleanValue(value = '') {
  return String(value)
    .replace(/^[\s:ـ\-–—|/\\.,;]+/, '')
    .replace(/[\s:ـ\-–—|/\\.,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDateInput(value = '') {
  const raw = cleanValue(value)
  if (!raw) return ''

  const western = toWesternDigits(raw)
    .replace(/[.]/g, '/')
    .replace(/\s+/g, '')
    .replace(/[^\d/-]/g, '')

  const ymd = western.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`

  const dmy = western.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`

  return ''
}

function normalizeNationalId(value = '') {
  return toWesternDigits(value).replace(/\D/g, '').slice(0, 12)
}

function normalizeGovernorate(value = '') {
  const v = cleanValue(value).replace(/^ال/, '').trim()
  const map = { بصره: 'بصرة', اربيل: 'أربيل', الانبار: 'أنبار', ديالي: 'ديالى', حله: 'بابل', حلة: 'بابل' }
  return map[v] || v
}

function normalizeVehicleTypeName(value = '') {
  const raw = cleanValue(value)
  if (!raw) return ''

  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()

  const aliases = {
    سكانيا: 'سكانيا',
    مرسيدس: 'مارسيدس',
    مان: 'مان',
    فولفو: 'فولفو',
  }

  return aliases[normalized] || raw
}

function normalizeResult(payload) {
  const src = payload?.data?.data || payload?.data || payload || {}
  const fullText = src.rawText || src.text || ''

  const findFirst = (keys) => {
    for (const key of keys) {
      if (src[key]) return src[key]
    }
    return ''
  }

  return {
    driverName: cleanValue(findFirst(['driverName'])),
    motherName: cleanValue(findFirst(['motherName'])),
    birthDate: normalizeDateInput(findFirst(['birthDate'])),
    nationalId: normalizeNationalId(findFirst(['nationalId'])),
    address: cleanValue(findFirst(['address'])),
    vehicleNumber: extractVehicleNumberSmart(fullText),
    governorate: normalizeGovernorate(findFirst(['governorate'])),
    vehicleTypeName: normalizeVehicleTypeName(findFirst(['vehicleTypeName'])),
    ownerName: cleanValue(findFirst(['ownerName'])),
    annualExpiry: normalizeDateInput(findFirst(['annualExpiry'])),
    rawText: fullText,
  }
}

const fieldLabels = {
  driverName: 'اسم السائق',
  motherName: 'اسم الأم',
  birthDate: 'تاريخ الميلاد',
  nationalId: 'الرقم الوطني',
  address: 'العنوان',
  vehicleNumber: 'رقم المركبة',
  governorate: 'المحافظة',
  vehicleTypeName: 'نوع المركبة',
  ownerName: 'اسم المالك',
  annualExpiry: 'انتهاء السنوية',
  rawText: 'النص المستخرج',
}

export default function AddDataByImage() {
  const [image, setImage] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [testingTwain, setTestingTwain] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [apiSuccess, setApiSuccess] = useState('')
  const [form, setForm] = useState(initialForm)

  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const resetMessages = () => {
    setApiError('')
    setApiSuccess('')
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    resetMessages()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleScanFromScanner = async () => {
    resetMessages()
    setScanning(true)

    try {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }

      const { file } = await scanDocumentImage(token, { mode: 'fast' })
      setImage(file)
      setPreviewUrl(URL.createObjectURL(file))
      setForm(initialForm)
    } catch (error) {
      setApiError(getScannerErrorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  const handleTestTwain = async () => {
    resetMessages()
    setTestingTwain(true)

    try {
      const result = await testTwainScanner(token)
      setApiSuccess(result.message)
    } catch (error) {
      setApiError(getScannerErrorMessage(error))
    } finally {
      setTestingTwain(false)
    }
  }

  const handleExtract = async () => {
    if (!image) {
      setApiError('اختر صورة أولاً قبل بدء الاستخراج')
      return
    }

    resetMessages()
    setExtracting(true)
    try {
      const fd = new FormData()
      fd.append('image', image)

      const res = await axios.post('/api/image-data/extract', fd, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const normalized = normalizeResult(res.data)
      setForm(normalized)
      setApiSuccess('تم استخراج البيانات من الصورة بنجاح')
    } catch {
      setApiError('فشل استخراج البيانات من الصورة')
    } finally {
      setExtracting(false)
    }
  }

  const handleSave = async () => {
    resetMessages()
    setSaving(true)
    try {
      await axios.post('/api/image-data/save', form, {
        headers: { Authorization: `Bearer ${token}` },
      })

      setApiSuccess('تم حفظ البيانات بنجاح')
      setForm(initialForm)
      setImage(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
      setPreviewUrl('')
    } catch {
      setApiError('فشل حفظ البيانات')
    } finally {
      setSaving(false)
    }
  }

  const handleFieldChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="image-data-page">
      <section className="image-data-hero card">
        <div>
          <span className="image-data-badge">OCR</span>
          <h1 className="image-data-title">إضافة البيانات بالصور</h1>
          <p className="image-data-subtitle">
            ارفع صورة مستند المركبة، استخرج البيانات تلقائياً، ثم راجع الحقول واحفظها داخل النظام.
          </p>
        </div>
      </section>

      {(apiError || apiSuccess) && (
        <div className={`alert ${apiError ? 'error' : 'success'}`}>
          {apiError || apiSuccess}
        </div>
      )}

      <div className="image-data-layout">
        <section className="card image-upload-card">
          <div className="image-data-section-head">
            <div>
              <h3>الصورة</h3>
              <p>ارفع صورة واضحة ليتم تحليلها واستخراج البيانات منها.</p>
            </div>
          </div>

          <div className="image-upload-actions">
            <label className="btn btn-primary image-action-btn" style={{ cursor: 'pointer' }}>
              <input type="file" accept="image/*" onChange={handleFileChange} hidden />
              {image ? 'تغيير الصورة' : 'اختر صورة من الجهاز'}
            </label>

            <button
              type="button"
              className="btn vo-btn-cancel image-action-btn image-secondary-btn"
              onClick={handleScanFromScanner}
              disabled={scanning}
            >
              {scanning ? 'جاري السحب...' : 'سحب من السكنر'}
            </button>

            <button
              type="button"
              className="btn vo-btn-cancel image-action-btn image-secondary-btn"
              onClick={handleTestTwain}
              disabled={testingTwain}
            >
              {testingTwain ? 'جاري الاختبار...' : 'اختبار TWAIN'}
            </button>
          </div>

          <p style={{ marginTop: 10, color: '#64748b', fontSize: 13 }}>
            يفضل أن تكون الصورة واضحة ومباشرة بدون قص زائد. تم تفعيل وضع سريع لالتقاط الصفحة من السكانر.
          </p>
          <p style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
            تأكد من وجود الورق داخل الـ feeder، وستظهر نافذة تقدم NAPS2 أثناء السحب.
          </p>

          <ScannerDevicesInfo token={token} />

          {previewUrl ? (
            <div className="image-preview-frame">
              <img src={previewUrl} alt="معاينة الصورة" className="image-preview" />
            </div>
          ) : (
            <div className="image-preview-empty">لا توجد صورة محددة حالياً</div>
          )}

          <div className="image-upload-actions">
            <button
              type="button"
              className="btn btn-primary image-action-btn"
              onClick={handleExtract}
              disabled={!image || extracting}
            >
              {extracting ? 'جارٍ الاستخراج...' : 'استخراج البيانات'}
            </button>

            <button
              type="button"
              className="btn vo-btn-cancel image-action-btn image-secondary-btn"
              onClick={() => {
                resetMessages()
                setForm(initialForm)
                setImage(null)
                if (previewUrl) {
                  URL.revokeObjectURL(previewUrl)
                }
                setPreviewUrl('')
              }}
              disabled={!image && !previewUrl}
            >
              إعادة تعيين
            </button>
          </div>
        </section>

        <section className="card image-form-card">
          <div className="image-data-section-head">
            <div>
              <h3>البيانات المستخرجة</h3>
              <p>يمكنك تعديل القيم قبل الحفظ إذا احتاجت إلى تصحيح يدوي.</p>
            </div>
          </div>

          <div className="image-form-grid">
            <div className="form-group">
              <label>{fieldLabels.driverName}</label>
              <input value={form.driverName} onChange={(e) => handleFieldChange('driverName', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.motherName}</label>
              <input value={form.motherName} onChange={(e) => handleFieldChange('motherName', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.birthDate}</label>
              <input type="date" value={form.birthDate} onChange={(e) => handleFieldChange('birthDate', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.nationalId}</label>
              <input value={form.nationalId} onChange={(e) => handleFieldChange('nationalId', e.target.value)} />
            </div>

            <div className="form-group image-form-span-2">
              <label>{fieldLabels.address}</label>
              <input value={form.address} onChange={(e) => handleFieldChange('address', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.vehicleNumber}</label>
              <input value={form.vehicleNumber} onChange={(e) => handleFieldChange('vehicleNumber', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.governorate}</label>
              <select
                value={form.governorate}
                onChange={(e) => handleFieldChange('governorate', e.target.value)}
                className="image-form-select"
              >
                <option value="">اختر المحافظة</option>
                {GOVERNORATES.map((gov) => (
                  <option key={gov} value={gov}>{gov}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>{fieldLabels.vehicleTypeName}</label>
              <input value={form.vehicleTypeName} onChange={(e) => handleFieldChange('vehicleTypeName', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.ownerName}</label>
              <input value={form.ownerName} onChange={(e) => handleFieldChange('ownerName', e.target.value)} />
            </div>

            <div className="form-group">
              <label>{fieldLabels.annualExpiry}</label>
              <input type="date" value={form.annualExpiry} onChange={(e) => handleFieldChange('annualExpiry', e.target.value)} />
            </div>

            <div className="form-group image-form-span-2">
              <label>{fieldLabels.rawText}</label>
              <textarea
                rows="8"
                value={form.rawText}
                onChange={(e) => handleFieldChange('rawText', e.target.value)}
                className="image-form-textarea"
                placeholder="سيظهر هنا النص المستخرج من الصورة"
              />
            </div>
          </div>

          <div className="image-save-bar">
            <button
              type="button"
              className="btn btn-primary image-save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'جارٍ الحفظ...' : 'حفظ البيانات'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
