import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const API_BASE = 'http://localhost:5000'

const FIELD_OPTIONS = [
  { key: 'documentType', label: 'نوع المستند' },
  { key: 'documentNumber', label: 'رقم المستند' },
  { key: 'issueDate', label: 'تاريخ الإصدار' },
  { key: 'loadingWarehouseName', label: 'الجهة المجهزة' },
  { key: 'receiverEntity', label: 'الجهة المرسل إليها' },
  { key: 'vehicleField', label: 'رقم المركبة' },
  { key: 'productType', label: 'نوع المنتوج' },
  { key: 'quantityLiters', label: 'الكمية المجهزة' },
  { key: 'driverName', label: 'اسم السائق' },
]

const TEMPLATE_KIND_OPTIONS = [
  { key: 'unloading', label: 'تسجيل التفريغ' },
  { key: 'loading', label: 'تسجيل التحميل' },
]

const DOCUMENT_TYPE_OPTIONS = {
  unloading: [
    { key: '68a', label: '68ا' },
    { key: '68b', label: '68ب' },
    { key: '68c', label: '68ج' },
    { key: '126-export', label: '126 تصديري' },
  ],
  loading: [
    { key: '90', label: '90' },
    { key: '15', label: '15' },
  ],
}

const colorPalette = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
]

const MIN_RECT_SIZE = 0.005

const RESIZE_HANDLES = [
  { key: 'nw', cursor: 'nwse-resize', left: 0, top: 0 },
  { key: 'n', cursor: 'ns-resize', left: 50, top: 0 },
  { key: 'ne', cursor: 'nesw-resize', left: 100, top: 0 },
  { key: 'e', cursor: 'ew-resize', left: 100, top: 50 },
  { key: 'se', cursor: 'nwse-resize', left: 100, top: 100 },
  { key: 's', cursor: 'ns-resize', left: 50, top: 100 },
  { key: 'sw', cursor: 'nesw-resize', left: 0, top: 100 },
  { key: 'w', cursor: 'ew-resize', left: 0, top: 50 },
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getImageUrl(file) {
  if (!file) return ''
  if (typeof file === 'string') return file
  return URL.createObjectURL(file)
}

function round6(value) {
  return Number(Number(value || 0).toFixed(6))
}

function getDefaultDocumentType(templateKind = 'unloading') {
  return DOCUMENT_TYPE_OPTIONS[templateKind]?.[0]?.key || ''
}

function getDefaultTemplateName(templateKind = 'unloading', documentTypeCode = '') {
  if (documentTypeCode) return `${templateKind}-${documentTypeCode}-template`
  return templateKind === 'loading' ? 'loading-template' : 'unloading-template'
}

function normalizeRect(rect) {
  let x = Number(rect.x || 0)
  let y = Number(rect.y || 0)
  let w = Number(rect.w || 0)
  let h = Number(rect.h || 0)

  x = clamp(x, 0, 1)
  y = clamp(y, 0, 1)
  w = clamp(w, MIN_RECT_SIZE, 1)
  h = clamp(h, MIN_RECT_SIZE, 1)

  if (x + w > 1) w = 1 - x
  if (y + h > 1) h = 1 - y

  w = clamp(w, MIN_RECT_SIZE, 1)
  h = clamp(h, MIN_RECT_SIZE, 1)

  return {
    x: round6(x),
    y: round6(y),
    w: round6(w),
    h: round6(h),
  }
}

function resizeRect(startRect, dir, dx, dy) {
  let { x, y, w, h } = startRect
  const right = x + w
  const bottom = y + h

  if (dir.includes('e')) w = right + dx - x
  if (dir.includes('s')) h = bottom + dy - y

  if (dir.includes('w')) {
    x = x + dx
    w = right - x
  }

  if (dir.includes('n')) {
    y = y + dy
    h = bottom - y
  }

  if (w < MIN_RECT_SIZE) {
    if (dir.includes('w')) x = right - MIN_RECT_SIZE
    w = MIN_RECT_SIZE
  }

  if (h < MIN_RECT_SIZE) {
    if (dir.includes('n')) y = bottom - MIN_RECT_SIZE
    h = MIN_RECT_SIZE
  }

  if (x < 0) {
    if (dir.includes('w')) w += x
    x = 0
  }

  if (y < 0) {
    if (dir.includes('n')) h += y
    y = 0
  }

  if (x + w > 1) w = 1 - x
  if (y + h > 1) h = 1 - y

  return normalizeRect({ x, y, w, h })
}

const DEFAULT_STARTER_RECT = { x: 0.1, y: 0.1, w: 0.2, h: 0.08 }

function getStarterRect(existingRects = {}) {
  const count = Object.keys(existingRects || {}).length
  const offset = Math.min(count * 0.03, 0.18)
  return normalizeRect({
    x: clamp(DEFAULT_STARTER_RECT.x + offset, 0, 0.8),
    y: clamp(DEFAULT_STARTER_RECT.y + offset, 0, 0.85),
    w: DEFAULT_STARTER_RECT.w,
    h: DEFAULT_STARTER_RECT.h,
  })
}

export default function DocumentTemplateMapper() {
  const [imageFile, setImageFile] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [templateKind, setTemplateKind] = useState('unloading')
  const [documentTypeCode, setDocumentTypeCode] = useState(getDefaultDocumentType('unloading'))
  const [templateName, setTemplateName] = useState(
    getDefaultTemplateName('unloading', getDefaultDocumentType('unloading'))
  )
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState('')
  const [referenceImageName, setReferenceImageName] = useState('')
  const [selectedField, setSelectedField] = useState(FIELD_OPTIONS[0].key)
  const [rectangles, setRectangles] = useState({})
  const [drawing, setDrawing] = useState(null)
  const [draggingRect, setDraggingRect] = useState(null)
  const [resizingRect, setResizingRect] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState(false)
  const [templates, setTemplates] = useState([])
  const [apiMessage, setApiMessage] = useState('')
  const [apiError, setApiError] = useState('')
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)

  const imageRef = useRef(null)
  const token = localStorage.getItem('token')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const selectedLabel =
    FIELD_OPTIONS.find((f) => f.key === selectedField)?.label || selectedField

  const selectedRect = rectangles[selectedField] || null
  const templateTypeOptions = DOCUMENT_TYPE_OPTIONS[templateKind] || []
  const selectedSavedTemplate = templates.find((item) => item.templateName === templateName) || null

  const applyTemplateData = (data) => {
    const fields = data?.fields || {}
    const normalizedFields = {}

    Object.entries(fields).forEach(([key, rect]) => {
      normalizedFields[key] = normalizeRect(rect)
    })

    setRectangles(normalizedFields)

    if (data?.imageMeta) {
      setNaturalSize({
        width: data.imageMeta.width || 1,
        height: data.imageMeta.height || 1,
      })
    }

    if (typeof data?.documentTypeCode === 'string' && data.documentTypeCode) {
      setDocumentTypeCode(data.documentTypeCode)
    }

    if (typeof data?.referenceImage === 'string') {
      setReferenceImageDataUrl(data.referenceImage)
      setImageUrl(data.referenceImage)
    }

    if (typeof data?.referenceImageName === 'string') {
      setReferenceImageName(data.referenceImageName)
    }
  }

  const loadTemplateList = async (kind = templateKind) => {
    setLoadingTemplates(true)
    try {
      const { data } = await axios.get(`${API_BASE}/api/templates`, {
        headers,
        params: { documentKind: kind },
      })
      if (data?.success && Array.isArray(data?.data)) {
        setTemplates(data.data)
      }
    } catch (err) {
      console.warn('loadTemplateList failed:', err?.message || err)
    } finally {
      setLoadingTemplates(false)
    }
  }

  const deleteTemplate = async (name = templateName) => {
    if (!name) return

    const safeName = String(name).trim()
    if (!safeName) return

    const confirmed = window.confirm(`هل تريد حذف القالب "${safeName}"؟`)
    if (!confirmed) return

    setDeletingTemplate(true)
    setApiError('')
    setApiMessage('')

    try {
      const { data } = await axios.delete(`${API_BASE}/api/templates/${encodeURIComponent(safeName)}`, { headers })

      if (!data?.success) {
        setApiError(data?.message || 'فشل حذف القالب')
        return
      }

      setTemplates((prev) => prev.filter((item) => item.templateName !== safeName))
      if (templateName === safeName) {
        setTemplateName(getDefaultTemplateName(templateKind, documentTypeCode))
        setRectangles({})
        setImageFile(null)
        setImageUrl('')
        setReferenceImageDataUrl('')
        setReferenceImageName('')
      }
      setApiMessage('تم حذف القالب بنجاح')
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل حذف القالب')
    } finally {
      setDeletingTemplate(false)
    }
  }

  const loadTemplate = async (name = templateName) => {
    if (!name) return

    setLoadingTemplate(true)
    setApiError('')
    setApiMessage('')

    try {
      const { data } = await axios.get(`${API_BASE}/api/templates/${name}`, { headers })

      if (!data?.success || !data?.data) {
        setApiError(data?.message || 'تعذر تحميل القالب')
        return
      }

      applyTemplateData(data.data)
      setApiMessage('تم تحميل القالب بنجاح')
    } catch (err) {
      setApiError(err.response?.data?.message || 'تعذر تحميل القالب')
    } finally {
      setLoadingTemplate(false)
    }
  }

  useEffect(() => {
    const nextDocumentType = getDefaultDocumentType(templateKind)
    const nextTemplateName = getDefaultTemplateName(templateKind, nextDocumentType)
    setDocumentTypeCode(nextDocumentType)
    setTemplateName(nextTemplateName)
    loadTemplate(nextTemplateName)
    loadTemplateList(templateKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKind])

  useEffect(() => {
    loadTemplateList(templateKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!documentTypeCode) return
    setTemplateName(getDefaultTemplateName(templateKind, documentTypeCode))
  }, [templateKind, documentTypeCode])

  const handleImageChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    setImageUrl(getImageUrl(file))
    setApiMessage('')
    setApiError('')
    setZoom(1)
    setReferenceImageName(file.name || '')
    setDrawing(null)
    setDraggingRect(null)
    setResizingRect(null)

    const reader = new FileReader()
    reader.onload = () => {
      setReferenceImageDataUrl(String(reader.result || ''))
    }
    reader.readAsDataURL(file)
  }

  const handleWheelZoom = (e) => {
    if (!imageUrl) return
    e.preventDefault()

    setZoom((prev) => {
      const step = e.deltaY < 0 ? 0.1 : -0.1
      return clamp(Number((prev + step).toFixed(2)), 0.3, 5)
    })
  }

  const getRelativePoint = (clientX, clientY) => {
    const img = imageRef.current
    if (!img) return null

    const rect = img.getBoundingClientRect()
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)

    return { x, y }
  }

  const beginDraw = (e) => {
    if (!imageUrl) return
    const point = getRelativePoint(e.clientX, e.clientY)
    if (!point) return

    setDrawing({
      field: selectedField,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    })
  }

  const handleCanvasPointerDown = (e) => {
    if (draggingRect || resizingRect) return
    beginDraw(e)
  }

  const handlePointerMove = (e) => {
    const point = getRelativePoint(e.clientX, e.clientY)
    if (!point) return

    if (resizingRect) {
      const dx = point.x - resizingRect.startPoint.x
      const dy = point.y - resizingRect.startPoint.y
      const nextRect = resizeRect(resizingRect.startRect, resizingRect.dir, dx, dy)

      setRectangles((prev) => ({
        ...prev,
        [resizingRect.field]: nextRect,
      }))
      return
    }

    if (draggingRect) {
      const { field, offsetX, offsetY, w, h } = draggingRect
      let nextX = point.x - offsetX
      let nextY = point.y - offsetY

      nextX = clamp(nextX, 0, 1 - w)
      nextY = clamp(nextY, 0, 1 - h)

      setRectangles((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          x: round6(nextX),
          y: round6(nextY),
        },
      }))
      return
    }

    if (!drawing) return

    setDrawing((prev) => ({
      ...prev,
      currentX: point.x,
      currentY: point.y,
    }))
  }

  const handlePointerUp = () => {
    if (resizingRect) {
      setResizingRect(null)
      return
    }

    if (draggingRect) {
      setDraggingRect(null)
      return
    }

    if (!drawing) return

    const x1 = Math.min(drawing.startX, drawing.currentX)
    const y1 = Math.min(drawing.startY, drawing.currentY)
    const x2 = Math.max(drawing.startX, drawing.currentX)
    const y2 = Math.max(drawing.startY, drawing.currentY)

    const w = x2 - x1
    const h = y2 - y1

    if (w > MIN_RECT_SIZE && h > MIN_RECT_SIZE) {
      setRectangles((prev) => ({
        ...prev,
        [drawing.field]: normalizeRect({
          x: x1,
          y: y1,
          w,
          h,
        }),
      }))
    }

    setDrawing(null)
  }

  const handleRectPointerDown = (e, fieldKey) => {
    e.stopPropagation()

    const rect = rectangles[fieldKey]
    if (!rect) return

    const point = getRelativePoint(e.clientX, e.clientY)
    if (!point) return

    setSelectedField(fieldKey)
    setDraggingRect({
      field: fieldKey,
      offsetX: point.x - rect.x,
      offsetY: point.y - rect.y,
      w: rect.w,
      h: rect.h,
    })
  }

  const handleResizePointerDown = (e, fieldKey, dir) => {
    e.stopPropagation()

    const rect = rectangles[fieldKey]
    if (!rect) return

    const point = getRelativePoint(e.clientX, e.clientY)
    if (!point) return

    setSelectedField(fieldKey)
    setResizingRect({
      field: fieldKey,
      dir,
      startPoint: point,
      startRect: { ...rect },
    })
  }

  const removeField = (fieldKey) => {
    setRectangles((prev) => {
      const copy = { ...prev }
      delete copy[fieldKey]
      return copy
    })
  }

  const activateField = (fieldKey) => {
    setSelectedField(fieldKey)
    setRectangles((prev) => {
      if (prev[fieldKey]) return prev
      return {
        ...prev,
        [fieldKey]: getStarterRect(prev),
      }
    })
  }

  const updateSelectedRect = (key, value) => {
    if (!selectedRect) return

    const numericValue = Number(value)
    if (Number.isNaN(numericValue)) return

    setRectangles((prev) => ({
      ...prev,
      [selectedField]: normalizeRect({
        ...prev[selectedField],
        [key]: round6(numericValue),
      }),
    }))
  }

  const nudgeSelectedRect = (key, delta) => {
    if (!selectedRect) return
    updateSelectedRect(key, round6((selectedRect[key] || 0) + delta))
  }

  const saveTemplate = async () => {
    if (!Object.keys(rectangles).length) {
      setApiError('يرجى تحديد حقل واحد على الأقل')
      return
    }

    setSaving(true)
    setApiError('')
    setApiMessage('')

    try {
      const payload = {
        templateName,
        documentKind: templateKind,
        documentTypeCode,
        fields: rectangles,
        imageMeta: naturalSize,
        referenceImage: referenceImageDataUrl,
        referenceImageName,
      }

      const { data } = await axios.post(
        `${API_BASE}/api/templates/save`,
        payload,
        { headers }
      )

      if (!data?.success) {
        setApiError(data?.message || 'فشل في حفظ القالب')
        return
      }

      if (data?.data) {
        applyTemplateData(data.data)
      }

      loadTemplateList(templateKind)
      setApiMessage('تم حفظ القالب بنجاح')
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في حفظ القالب')
    } finally {
      setSaving(false)
    }
  }

  const drawingRect = (() => {
    if (!drawing) return null
    const x = Math.min(drawing.startX, drawing.currentX)
    const y = Math.min(drawing.startY, drawing.currentY)
    const w = Math.abs(drawing.currentX - drawing.startX)
    const h = Math.abs(drawing.currentY - drawing.startY)
    return { x, y, w, h }
  })()

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div>
          <div className="pricing-kicker">🧭 إعداد قالب المستند</div>
          <h1 className="pricing-title">تحديد أماكن الحقول يدويًا</h1>
          <p className="pricing-subtitle">
            ارسم الإطار، ثم حرّكه أو غيّر حجمه بالماوس من الزوايا والجوانب.
          </p>
        </div>
      </div>

      {(apiError || apiMessage) && (
        <div className={`pricing-alert ${apiError ? 'pricing-alert-error' : 'pricing-alert-success'}`}>
          {apiError || apiMessage}
        </div>
      )}

      <div className="pricing-card">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">إعداد القالب</h2>
            <p className="pricing-card-subtitle">يمكنك تحميل القالب المحفوظ عند العودة إلى الصفحة</p>
          </div>
        </div>

        <div className="pricing-form">
          <div className="pricing-grid-3">
            <div className="pricing-field">
              <label className="pricing-label">نوع الصفحة</label>
              <select
                className="pricing-input"
                value={templateKind}
                onChange={(e) => setTemplateKind(e.target.value)}
              >
                {TEMPLATE_KIND_OPTIONS.map((kind) => (
                  <option key={kind.key} value={kind.key}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pricing-field">
              <label className="pricing-label">نوع المستند</label>
              <select
                className="pricing-input"
                value={documentTypeCode}
                onChange={(e) => setDocumentTypeCode(e.target.value)}
              >
                {templateTypeOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pricing-field">
              <label className="pricing-label">اسم القالب</label>
              <input
                className="pricing-input template-name-input"
                dir="ltr"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <div className="template-name-preview" dir="ltr">
                {templateName || 'loading-template'}
              </div>
              <div className="pricing-hint" style={{ marginTop: 8 }}>
                الاسم يتولّد تلقائيًا ويمكن تعديله يدويًا عند الحاجة.
              </div>
            </div>

            <div className="pricing-field">
              <label className="pricing-label">الحقل الحالي</label>
              <select
                className="pricing-input"
                value={selectedField}
                onChange={(e) => activateField(e.target.value)}
              >
                {FIELD_OPTIONS.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pricing-field">
              <label className="pricing-label">رفع صورة مرجعية</label>
              <label className="pricing-btn pricing-btn-secondary" style={{ cursor: 'pointer', width: 'fit-content' }}>
                اختيار صورة
                <input type="file" accept="image/*" onChange={handleImageChange} hidden />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <button
              type="button"
              className="pricing-btn pricing-btn-secondary"
              onClick={() => loadTemplate(templateName || getDefaultTemplateName(templateKind))}
              disabled={loadingTemplate}
            >
              {loadingTemplate ? 'جاري التحميل...' : 'تحميل القالب'}
            </button>

            <button
              type="button"
              className="pricing-btn pricing-btn-primary"
              onClick={saveTemplate}
              disabled={saving}
            >
              {saving ? 'جاري الحفظ...' : 'حفظ القالب'}
            </button>
          </div>

          <div className="pricing-card" style={{ marginTop: 18, background: '#fbfdff' }}>
            <div className="pricing-card-header" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="pricing-card-title" style={{ fontSize: 24 }}>القوالب المحفوظة</h3>
                <p className="pricing-card-subtitle">
                  اختر قالبًا من القائمة أو احفظ قالبًا جديدًا مع صورته المرجعية.
                </p>
              </div>
            </div>

            <div className="pricing-hint" style={{ marginBottom: 10 }}>
              يمكنك حذف القالب القديم من هنا بعد التأكد من عدم الحاجة إليه.
            </div>

            {selectedSavedTemplate ? (
              <div className="pricing-alert pricing-alert-success" style={{ marginBottom: 12 }}>
                القالب المحدد حاليًا: <strong>{selectedSavedTemplate.templateName}</strong>
              </div>
            ) : null}

            <div className="template-list">
              {templates.length ? templates.map((item) => (
                <div key={item.templateName} className="template-list-item">
                  <button
                    type="button"
                    className="template-list-item-body"
                    onClick={() => {
                      setTemplateKind(item.documentKind || 'unloading')
                      setDocumentTypeCode(item.documentTypeCode || getDefaultDocumentType(item.documentKind || 'unloading'))
                      setTemplateName(item.templateName)
                      loadTemplate(item.templateName)
                    }}
                  >
                    <div className="template-list-item-title" dir="ltr">
                      {item.templateName}
                    </div>
                    <div className="template-list-item-meta">
                      {item.documentKind || 'unloading'} | {item.documentTypeCode || '-'} | {item.fieldCount || 0} fields
                    </div>
                    <div className="template-list-item-meta">
                      {item.hasReferenceImage ? 'Reference image saved' : 'No reference image'}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="template-list-item-delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteTemplate(item.templateName)
                    }}
                    disabled={deletingTemplate}
                  >
                    {deletingTemplate && templateName === item.templateName ? 'جاري الحذف...' : 'حذف'}
                  </button>
                </div>
              )) : (
                <div className="pricing-alert pricing-alert-info">
                  لم يتم حفظ أي قالب بعد.
                </div>
              )}
            </div>

            {selectedSavedTemplate ? (
              <div className="pricing-alert pricing-alert-error" style={{ marginTop: 14 }}>
                <strong>حذف القالب:</strong> إذا لم تعد بحاجة إلى هذا القالب، يمكنك حذفه من القائمة أعلاه وسيُزال الملف من التخزين مباشرة.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {imageUrl && (
        <>
          <div className="pricing-card">
            <div className="pricing-card-header">
              <div>
                <h2 className="pricing-card-title">ارسم الإطار ثم غيّر حجمه بالماوس</h2>
                <p className="pricing-card-subtitle">
                  الحقل المحدد الآن: <strong>{selectedLabel}</strong> — مستوى التكبير: <strong>{zoom.toFixed(2)}x</strong>
                </p>
              </div>
            </div>

            <div
              onWheel={handleWheelZoom}
              style={{
                position: 'relative',
                width: '100%',
                overflow: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 20,
                background: '#fff',
                padding: 12,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 'fit-content',
                  margin: '0 auto',
                  userSelect: 'none',
                  cursor: resizingRect ? 'grabbing' : draggingRect ? 'grabbing' : 'crosshair',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt="template-source"
                  style={{
                    maxWidth: '100%',
                    height: 'auto',
                    display: 'block',
                    borderRadius: 16,
                  }}
                  onLoad={(e) => {
                    setNaturalSize({
                      width: e.target.naturalWidth,
                      height: e.target.naturalHeight,
                    })
                  }}
                />

                {Object.entries(rectangles).map(([fieldKey, rect], index) => {
                  const field = FIELD_OPTIONS.find((f) => f.key === fieldKey)
                  const color = colorPalette[index % colorPalette.length]
                  const isSelected = fieldKey === selectedField

                  return (
                    <div
                      key={fieldKey}
                      onPointerDown={(e) => handleRectPointerDown(e, fieldKey)}
                      style={{
                        position: 'absolute',
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.w * 100}%`,
                        height: `${rect.h * 100}%`,
                        border: `${isSelected ? 4 : 3}px solid ${color}`,
                        background: `${color}${isSelected ? '22' : '14'}`,
                        boxSizing: 'border-box',
                        cursor: 'grab',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: -30,
                          right: 0,
                          background: color,
                          color: '#fff',
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        {field?.label || fieldKey}
                      </div>

                      {isSelected &&
                        RESIZE_HANDLES.map((handle) => (
                          <div
                            key={handle.key}
                            onPointerDown={(e) => handleResizePointerDown(e, fieldKey, handle.key)}
                            style={{
                              position: 'absolute',
                              left: `${handle.left}%`,
                              top: `${handle.top}%`,
                              width: 12,
                              height: 12,
                              transform: 'translate(-50%, -50%)',
                              background: '#fff',
                              border: `2px solid ${color}`,
                              borderRadius: 3,
                              boxSizing: 'border-box',
                              cursor: handle.cursor,
                            }}
                          />
                        ))}
                    </div>
                  )
                })}

                {drawingRect && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${drawingRect.x * 100}%`,
                      top: `${drawingRect.y * 100}%`,
                      width: `${drawingRect.w * 100}%`,
                      height: `${drawingRect.h * 100}%`,
                      border: '2px dashed #111827',
                      background: 'rgba(17,24,39,0.08)',
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="pricing-card">
            <div className="pricing-card-header">
              <div>
                <h2 className="pricing-card-title">تعديل يدوي دقيق للحقل المحدد</h2>
              </div>
            </div>

            {!selectedRect ? (
              <div className="pricing-alert pricing-alert-error">
                لم يتم رسم الحقل المحدد بعد
              </div>
            ) : (
              <div className="pricing-form">
                <div className="pricing-grid-3">
                  <div className="pricing-field">
                    <label className="pricing-label">x</label>
                    <input
                      className="pricing-input"
                      type="number"
                      step="0.001"
                      value={selectedRect.x}
                      onChange={(e) => updateSelectedRect('x', e.target.value)}
                    />
                  </div>

                  <div className="pricing-field">
                    <label className="pricing-label">y</label>
                    <input
                      className="pricing-input"
                      type="number"
                      step="0.001"
                      value={selectedRect.y}
                      onChange={(e) => updateSelectedRect('y', e.target.value)}
                    />
                  </div>

                  <div className="pricing-field">
                    <label className="pricing-label">w</label>
                    <input
                      className="pricing-input"
                      type="number"
                      step="0.001"
                      value={selectedRect.w}
                      onChange={(e) => updateSelectedRect('w', e.target.value)}
                    />
                  </div>

                  <div className="pricing-field">
                    <label className="pricing-label">h</label>
                    <input
                      className="pricing-input"
                      type="number"
                      step="0.001"
                      value={selectedRect.h}
                      onChange={(e) => updateSelectedRect('h', e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('x', -0.005)}>
                    ← يسار
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('x', 0.005)}>
                    يمين →
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('y', -0.005)}>
                    ↑ أعلى
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('y', 0.005)}>
                    ↓ أسفل
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('w', 0.01)}>
                    زيادة العرض
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => nudgeSelectedRect('h', 0.01)}>
                    زيادة الارتفاع
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => setZoom(1)}>
                    إعادة التكبير
                  </button>
                  <button type="button" className="pricing-btn pricing-btn-secondary" onClick={() => removeField(selectedField)}>
                    حذف الحقل المحدد
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="pricing-card">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">الحقول المحفوظة</h2>
          </div>
        </div>

        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>الحقل</th>
                <th>x</th>
                <th>y</th>
                <th>w</th>
                <th>h</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_OPTIONS.map((field) => {
                const rect = rectangles[field.key]
                return (
                  <tr key={field.key}>
                    <td>{field.label}</td>
                    <td>{rect?.x ?? '-'}</td>
                    <td>{rect?.y ?? '-'}</td>
                    <td>{rect?.w ?? '-'}</td>
                    <td>{rect?.h ?? '-'}</td>
                    <td>
                      {rect ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="pricing-btn pricing-btn-secondary"
                            onClick={() => activateField(field.key)}
                          >
                            تحديد
                          </button>
                          <button
                            type="button"
                            className="pricing-btn pricing-btn-secondary"
                            onClick={() => removeField(field.key)}
                          >
                            حذف
                          </button>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
