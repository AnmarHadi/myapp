import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import * as XLSX from 'xlsx'

const API_BASE = 'http://localhost:5000'

const formatDate = (d) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('ar-IQ')
  } catch {
    return '—'
  }
}

const isExpired = (date) => {
  if (!date) return false
  const d = new Date(date)
  if (isNaN(d.getTime())) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)

  return d < today
}

const normalizeNumber = (value) => {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function computeFairTripPlan(quantityLiters, selectedVehicles) {
  const totalQuantity = normalizeNumber(quantityLiters)

  const baseRows = selectedVehicles.map((v, index) => ({
    _id: v._id,
    orderIndex: index,
    driverName: v.driver?.name || '—',
    vehicleNumber: v.vehicleNumber || '—',
    governorate: v.governorate || '—',
    capacity: normalizeNumber(v.capacity),
    tripsCount: 0,
    totalLiters: 0,
    annualExpiry: v.annualExpiry || null,
    calibrationExpiry: v.calibrationExpiry || null,
    annualExpired: isExpired(v.annualExpiry),
    calibrationExpired: isExpired(v.calibrationExpiry),
    hasExpiredDoc: isExpired(v.annualExpiry) || isExpired(v.calibrationExpiry),
  }))

  if (totalQuantity <= 0 || baseRows.length === 0) {
    return {
      rows: baseRows,
      totalAssigned: 0,
      remaining: totalQuantity,
      possibleExactZero: false,
    }
  }

  const allocatable = baseRows.filter((v) => v.capacity > 0)

  if (allocatable.length === 0) {
    return {
      rows: baseRows,
      totalAssigned: 0,
      remaining: totalQuantity,
      possibleExactZero: false,
    }
  }

  let remaining = totalQuantity
  let safety = 0

  while (remaining > 0 && safety < 100000) {
    safety += 1

    allocatable.sort((a, b) => {
      if (a.tripsCount !== b.tripsCount) return a.tripsCount - b.tripsCount
      if (a.totalLiters !== b.totalLiters) return a.totalLiters - b.totalLiters
      if (b.capacity !== a.capacity) return b.capacity - a.capacity
      return a.orderIndex - b.orderIndex
    })

    const vehicle = allocatable[0]
    if (!vehicle || vehicle.capacity <= 0) break

    const load = Math.min(vehicle.capacity, remaining)
    vehicle.tripsCount += 1
    vehicle.totalLiters += load
    remaining -= load
  }

  const rows = baseRows
    .map((row) => ({
      ...row,
      totalLiters: normalizeNumber(row.totalLiters),
    }))
    .sort((a, b) => {
      if (b.totalLiters !== a.totalLiters) return b.totalLiters - a.totalLiters
      if (b.tripsCount !== a.tripsCount) return b.tripsCount - a.tripsCount
      return a.orderIndex - b.orderIndex
    })

  const totalAssigned = rows.reduce((sum, row) => sum + normalizeNumber(row.totalLiters), 0)

  return {
    rows,
    totalAssigned,
    remaining: Math.max(0, totalQuantity - totalAssigned),
    possibleExactZero: remaining === 0,
  }
}

export default function FormTripAllocator() {
  const token = localStorage.getItem('token')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [formSearch, setFormSearch] = useState('')
  const [formResults, setFormResults] = useState([])
  const [selectedForm, setSelectedForm] = useState(null)
  const [formLoading, setFormLoading] = useState(false)

  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleResults, setVehicleResults] = useState([])
  const [vehicleLoading, setVehicleLoading] = useState(false)
  const [selectedVehicles, setSelectedVehicles] = useState([])

  const [toast, setToast] = useState(null)
  const printRef = useRef(null)

  const recognitionRef = useRef(null)
  const [isListening, setIsListening] = useState(false)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const searchForms = useCallback(async () => {
    if (!formSearch.trim()) {
      setFormResults([])
      return
    }

    setFormLoading(true)
    try {
      const { data } = await axios.get(
        `/api/forms?search=${encodeURIComponent(formSearch.trim())}`,
        { headers }
      )

      setFormResults(Array.isArray(data) ? data : [])
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب الاستمارات', 'error')
    } finally {
      setFormLoading(false)
    }
  }, [formSearch, headers])

  const searchVehicles = useCallback(async (queryArg) => {
    const q = String(queryArg ?? vehicleSearch).trim()
    if (!q) {
      setVehicleResults([])
      return
    }

    setVehicleLoading(true)
    try {
      const { data } = await axios.get(
        `/api/vehicles?search=${encodeURIComponent(q)}`,
        { headers }
      )
      setVehicleResults(Array.isArray(data) ? data : [])
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب المركبات', 'error')
    } finally {
      setVehicleLoading(false)
    }
  }, [vehicleSearch, headers])

  const selectedQuantity = normalizeNumber(selectedForm?.quantityLiters)
  const allocation = useMemo(
    () => computeFairTripPlan(selectedQuantity, selectedVehicles),
    [selectedQuantity, selectedVehicles]
  )

  const handleAddVehicle = (vehicle) => {
    if (!vehicle?._id) return

    const exists = selectedVehicles.some((v) => String(v._id) === String(vehicle._id))
    if (exists) {
      showToast('هذه المركبة مضافة بالفعل', 'error')
      return
    }

    setSelectedVehicles((prev) => [...prev, vehicle])
  }

  const handleRemoveVehicle = (id) => {
    setSelectedVehicles((prev) => prev.filter((v) => String(v._id) !== String(id)))
  }

  const handleChooseForm = (form) => {
    setSelectedForm(form)
    setFormResults([])
    setFormSearch(form.number || '')
  }

  const handleExportExcel = () => {
    if (!selectedForm) {
      showToast('اختر استمارة أولاً', 'error')
      return
    }

    if (allocation.rows.length === 0) {
      showToast('لا توجد مركبات لتصديرها', 'error')
      return
    }

    const excelRows = allocation.rows.map((row, index) => ({
      التسلسل: index + 1,
      'اسم السائق': row.driverName,
      'حمولة المركبة (لتر)': row.capacity || 0,
      'رقم المركبة': row.vehicleNumber,
      العائدية: row.governorate || '—',
      'عدد النقلات': row.tripsCount,
      'مجموع النقلات باللتر': row.totalLiters,
    }))

    const ws = XLSX.utils.json_to_sheet(excelRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'توزيع النقلات')

    const safeFormNo = String(selectedForm.number || 'form').replace(/[\\/:*?"<>|]/g, '-')
    XLSX.writeFile(wb, `توزيع_نقلات_الاستمارة_${safeFormNo}.xlsx`)
  }

  const handlePrint = () => {
    if (!selectedForm) {
      showToast('اختر استمارة أولاً', 'error')
      return
    }
    window.print()
  }

  const startVoiceSearch = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      showToast('المتصفح لا يدعم الأوامر الصوتية', 'error')
      return
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'ar-IQ'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => setIsListening(true)

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || ''
      const text = String(transcript).trim()
      setVehicleSearch(text)
      if (text) {
        searchVehicles(text)
      }
    }

    recognition.onerror = () => {
      setIsListening(false)
      showToast('تعذر تنفيذ البحث الصوتي', 'error')
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
      }
    }
  }, [])

  return (
    <div className="page-container" dir="rtl">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .print-area, .print-area * {
            visibility: visible !important;
          }
          .print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            background: #fff;
            padding: 24px;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {toast && (
        <div className={`vo-toast ${toast.type}`}>
          {toast.msg}
        </div>
      )}

      <div className="page-header no-print">
        <h1>🧮 توزيع نقلات الاستمارة</h1>
        <p>اختيار الاستمارة والمركبات ثم توزيع الكمية بعدالة شبه متوازنة مع إمكانية تكرار النقلات.</p>
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>1) اختيار الاستمارة</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={formSearch}
            onChange={(e) => setFormSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchForms()}
            placeholder="ابحث برقم الاستمارة"
            style={{
              flex: 1,
              minWidth: 220,
              padding: '11px 14px',
              borderRadius: 10,
              border: '1.5px solid #e2e8f0',
              background: '#fff',
            }}
          />

          <button className="btn btn-primary" onClick={searchForms} disabled={!formSearch.trim() || formLoading}>
            {formLoading ? '⏳ جاري البحث...' : 'بحث'}
          </button>
        </div>

        {selectedForm && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 12,
              border: '1px solid #dbeafe',
              background: '#eff6ff',
            }}
          >
            <div><strong>رقم الاستمارة:</strong> {selectedForm.number}</div>
            <div><strong>تاريخ الاستمارة:</strong> {formatDate(selectedForm.formDate)}</div>
            <div><strong>كمية الاستمارة:</strong> {selectedForm.quantityLiters} لتر</div>
          </div>
        )}

        {formResults.length > 0 && (
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table className="vo-table">
              <thead>
                <tr>
                  <th>رقم الاستمارة</th>
                  <th>التاريخ</th>
                  <th>الكمية</th>
                  <th>اختيار</th>
                </tr>
              </thead>
              <tbody>
                {formResults.map((form) => (
                  <tr key={form._id}>
                    <td>{form.number}</td>
                    <td>{formatDate(form.formDate)}</td>
                    <td>{form.quantityLiters} لتر</td>
                    <td>
                      <button className="vo-btn-edit" onClick={() => handleChooseForm(form)}>
                        اختيار
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>2) اختيار المركبات</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchVehicles()}
            placeholder="ابحث برقم المركبة أو اسم السائق"
            style={{
              flex: 1,
              minWidth: 220,
              padding: '11px 14px',
              borderRadius: 10,
              border: '1.5px solid #e2e8f0',
              background: '#fff',
            }}
          />

          <button
            className="btn btn-primary"
            onClick={() => searchVehicles()}
            disabled={!vehicleSearch.trim() || vehicleLoading}
          >
            {vehicleLoading ? '⏳ جاري البحث...' : 'بحث'}
          </button>

          <button
            type="button"
            className="btn vo-btn-cancel"
            onClick={startVoiceSearch}
            style={{
              background: isListening ? '#fee2e2' : undefined,
              borderColor: isListening ? '#ef4444' : undefined,
              color: isListening ? '#991b1b' : undefined,
            }}
          >
            {isListening ? '🎙️ جاري الاستماع...' : '🎤 بحث صوتي'}
          </button>
        </div>

        {vehicleResults.length > 0 && (
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table className="vo-table">
              <thead>
                <tr>
                  <th>السائق</th>
                  <th>رقم المركبة</th>
                  <th>العائدية</th>
                  <th>الحمولة</th>
                  <th>الحالة</th>
                  <th>اختيار</th>
                </tr>
              </thead>
              <tbody>
                {vehicleResults.map((v) => {
                  const annualExpired = isExpired(v.annualExpiry)
                  const calibrationExpired = isExpired(v.calibrationExpiry)
                  const hasExpiredDoc = annualExpired || calibrationExpired

                  return (
                    <tr
                      key={v._id}
                      style={hasExpiredDoc ? { background: '#fef2f2' } : undefined}
                    >
                      <td>{v.driver?.name || '—'}</td>
                      <td>{v.vehicleNumber || '—'}</td>
                      <td>{v.governorate || '—'}</td>
                      <td>{v.capacity != null ? `${v.capacity} لتر` : '—'}</td>
                      <td>
                        {hasExpiredDoc ? (
                          <span style={{ color: '#dc2626', fontWeight: 700 }}>
                            🔴 منتهي
                            {annualExpired && ' / السنوية'}
                            {annualExpired && calibrationExpired && ' + '}
                            {calibrationExpired && 'شهادة التكييل'}
                          </span>
                        ) : (
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>🟢 ساري</span>
                        )}
                      </td>
                      <td>
                        <button className="vo-btn-edit" onClick={() => handleAddVehicle(v)}>
                          إضافة
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedVehicles.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h4 style={{ marginBottom: 10 }}>المركبات المختارة</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="vo-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>السائق</th>
                    <th>رقم المركبة</th>
                    <th>العائدية</th>
                    <th>الحمولة</th>
                    <th>الحالة</th>
                    <th>إزالة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedVehicles.map((v, idx) => {
                    const annualExpired = isExpired(v.annualExpiry)
                    const calibrationExpired = isExpired(v.calibrationExpiry)
                    const hasExpiredDoc = annualExpired || calibrationExpired

                    return (
                      <tr
                        key={v._id}
                        style={hasExpiredDoc ? { background: '#fef2f2' } : undefined}
                      >
                        <td>{idx + 1}</td>
                        <td>{v.driver?.name || '—'}</td>
                        <td>{v.vehicleNumber || '—'}</td>
                        <td>{v.governorate || '—'}</td>
                        <td>{v.capacity != null ? `${v.capacity} لتر` : '—'}</td>
                        <td>
                          {hasExpiredDoc ? (
                            <span style={{ color: '#dc2626', fontWeight: 700 }}>🔴 منتهي</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontWeight: 700 }}>🟢 ساري</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="vo-btn-delete"
                            onClick={() => handleRemoveVehicle(v._id)}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>3) نتيجة التوزيع</h3>
            <div style={{ color: '#64748b' }}>
              يتم توزيع النقلات بعدالة تقريبية، مع السماح بتكرار النقلة على نفس المركبة عند الحاجة.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn vo-btn-cancel" onClick={handleExportExcel}>
              📥 تصدير Excel
            </button>
            <button className="btn btn-primary" onClick={handlePrint}>
              🖨️ طباعة
            </button>
          </div>
        </div>

        <div ref={printRef} className="print-area">
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ marginBottom: 8 }}>توزيع نقلات الاستمارة</h2>
            <div><strong>رقم الاستمارة:</strong> {selectedForm?.number || '—'}</div>
            <div><strong>كمية الاستمارة:</strong> {selectedForm ? `${selectedForm.quantityLiters} لتر` : '—'}</div>
            <div><strong>عدد المركبات المختارة:</strong> {selectedVehicles.length}</div>
            <div><strong>إجمالي الكمية الموزعة:</strong> {allocation.totalAssigned} لتر</div>
            <div><strong>الكمية المتبقية:</strong> {allocation.remaining} لتر</div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="vo-table">
              <thead>
                <tr>
                  <th>التسلسل</th>
                  <th>اسم السائق</th>
                  <th>حمولة المركبة</th>
                  <th>رقم المركبة</th>
                  <th>العائدية</th>
                  <th>عدد النقلات</th>
                  <th>مجموع النقلات باللتر</th>
                  <th className="no-print">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {allocation.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 20 }}>
                      اختر استمارة ومركبات لعرض التوزيع
                    </td>
                  </tr>
                ) : (
                  allocation.rows.map((row, idx) => (
                    <tr
                      key={row._id}
                      style={row.hasExpiredDoc ? { background: '#fef2f2' } : undefined}
                    >
                      <td>{idx + 1}</td>
                      <td>{row.driverName}</td>
                      <td>{row.capacity || 0} لتر</td>
                      <td>{row.vehicleNumber}</td>
                      <td>{row.governorate}</td>
                      <td>{row.tripsCount}</td>
                      <td>{row.totalLiters}</td>
                      <td className="no-print">
                        {row.hasExpiredDoc ? (
                          <span style={{ color: '#dc2626', fontWeight: 700 }}>
                            🔴 منتهي
                          </span>
                        ) : (
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>
                            🟢 ساري
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedForm && allocation.rows.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#f8fafc' }}>
              <div><strong>ملاحظة:</strong> إذا كانت آخر نقلة أقل من حمولة المركبة، يتم احتسابها كنقلة واحدة بكمية جزئية لضمان وصول الكمية المتبقية إلى الصفر متى أمكن.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}