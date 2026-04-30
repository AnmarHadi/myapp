import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import * as XLSX from 'xlsx'
import DocImageField from '../components/DocImageFieldWithScan'

const API_BASE = 'http://localhost:5000'

const getImageUrl = (src) => {
  if (!src) return ''
  if (src.startsWith('blob:')) return src
  if (src.startsWith('http://') || src.startsWith('https://')) return src
  return `${API_BASE}/${src.replace(/^\/+/, '')}`
}

const emptyForm = {
  name: '',
  motherName: '',
  birthDate: '',
  nationalId: '',
  nationalIdExpiry: '',
  address: '',
  licenseType: '',
  licenseExpiry: '',
  nationalIdFront: null,
  nationalIdBack: null,
  licenseFront: null,
  licenseBack: null,
}

const LICENSE_TYPES = ['', 'A', 'B', 'C', 'D', 'E', 'A+B', 'B+C', 'مهني']
const isExpired = (date) => date && new Date(date) < new Date()

export default function Drivers() {
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState(null)

  const [selected, setSelected] = useState([])
  const [bulkModal, setBulkModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [toast, setToast] = useState(null)

  const [xlsxModal, setXlsxModal] = useState(false)
  const [xlsxRows, setXlsxRows] = useState([])
  const [xlsxError, setXlsxError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [dupCount, setDupCount] = useState(0)

  const [previewImg, setPreviewImg] = useState(null)

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchDrivers = useCallback(async (search = '', showAll = false) => {
    setLoading(true)
    setSelected([])
    try {
      const url = search
        ? `/api/drivers?search=${encodeURIComponent(search)}`
        : '/api/drivers'
      const { data } = await axios.get(url, { headers })
      setDrivers(data)
      setHasSearched(!!search || showAll)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب البيانات', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {}, [])

  const handleSearch = () => {
    if (!searchInput.trim()) return
    fetchDrivers(searchInput.trim())
  }

  const handleShowAll = () => {
    setSearchInput('')
    fetchDrivers('', true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  const allSelected = drivers.length > 0 && selected.length === drivers.length
  const someSelected = selected.length > 0 && selected.length < drivers.length

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : drivers.map(d => d._id))
  }

  const toggleOne = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const openEdit = (d) => {
    setEditTarget(d)
    setForm({
      name: d.name,
      motherName: d.motherName || '',
      birthDate: d.birthDate ? d.birthDate.split('T')[0] : '',
      nationalId: d.nationalId || '',
      nationalIdExpiry: d.nationalIdExpiry ? d.nationalIdExpiry.split('T')[0] : '',
      address: d.address || '',
      licenseType: d.licenseType || '',
      licenseExpiry: d.licenseExpiry ? d.licenseExpiry.split('T')[0] : '',
      nationalIdFront: d.nationalIdFront ? { url: getImageUrl(d.nationalIdFront), existing: true } : null,
      nationalIdBack: d.nationalIdBack ? { url: getImageUrl(d.nationalIdBack), existing: true } : null,
      licenseFront: d.licenseFront ? { url: getImageUrl(d.licenseFront), existing: true } : null,
      licenseBack: d.licenseBack ? { url: getImageUrl(d.licenseBack), existing: true } : null,
    })
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
  }

  const handleChange = (e) => {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    setErrors(p => ({ ...p, [e.target.name]: '' }))
    setApiError('')
  }

  const handleImage = (field, val) => {
    setForm(p => ({ ...p, [field]: val }))
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'اسم السائق مطلوب'
    if (!form.motherName.trim()) e.motherName = 'اسم الأم الثلاثي مطلوب'
    if (form.nationalId && !/^\d{12}$/.test(form.nationalId.trim())) {
      e.nationalId = 'رقم البطاقة يجب أن يتكون من 12 رقماً بالضبط'
    }
    return e
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name)
      fd.append('motherName', form.motherName)
      fd.append('birthDate', form.birthDate)
      fd.append('nationalId', form.nationalId)
      fd.append('nationalIdExpiry', form.nationalIdExpiry)
      fd.append('address', form.address)
      fd.append('licenseType', form.licenseType)
      fd.append('licenseExpiry', form.licenseExpiry)

      if (form.nationalIdFront?.blob) fd.append('nationalIdFront', form.nationalIdFront.blob, 'nid_front.jpg')
      if (form.nationalIdBack?.blob) fd.append('nationalIdBack', form.nationalIdBack.blob, 'nid_back.jpg')
      if (form.licenseFront?.blob) fd.append('licenseFront', form.licenseFront.blob, 'lic_front.jpg')
      if (form.licenseBack?.blob) fd.append('licenseBack', form.licenseBack.blob, 'lic_back.jpg')

      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      }

      if (editTarget) {
        await axios.put(`/api/drivers/${editTarget._id}`, fd, config)
        showToast('تم تعديل السائق بنجاح ✅')
      } else {
        await axios.post('/api/drivers', fd, config)
        showToast('تم إضافة السائق بنجاح ✅')
      }

      closeModal()
      if (hasSearched) fetchDrivers(searchInput || '', !searchInput)
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await axios.delete(`/api/drivers/${deleteId}`, { headers })
      showToast('تم حذف السائق بنجاح 🗑️')
      setDeleteId(null)
      if (hasSearched) fetchDrivers(searchInput || '', !searchInput)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
      setDeleteId(null)
    }
  }

  const openBulkDelete = () => {
    setConfirmText('')
    setBulkModal(true)
  }

  const handleBulkDelete = async () => {
    if (confirmText !== 'حذف') return
    setDeleting(true)
    try {
      await axios.delete('/api/drivers/bulk', {
        headers,
        data: { ids: selected },
      })
      showToast(`تم حذف ${selected.length} سائق بنجاح 🗑️`)
      setBulkModal(false)
      setSelected([])
      if (hasSearched) fetchDrivers(searchInput || '', !searchInput)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const COLUMN_MAP = {
    'اسم السائق': 'name',
    'name': 'name',
    'اسم الأم': 'motherName',
    'اسم ام السائق': 'motherName',
    'mothername': 'motherName',
    'تاريخ الولادة': 'birthDate',
    'birthdate': 'birthDate',
    'رقم البطاقة': 'nationalId',
    'رقم البطاقة الوطنية': 'nationalId',
    'nationalid': 'nationalId',
    'تاريخ نفاذ البطاقة': 'nationalIdExpiry',
    'nationalidexpiry': 'nationalIdExpiry',
    'العنوان': 'address',
    'address': 'address',
    'نوع الرخصة': 'licenseType',
    'نوع رخصة القيادة': 'licenseType',
    'licensetype': 'licenseType',
    'تاريخ نفاذ الرخصة': 'licenseExpiry',
    'تاريخ نفاذ رخصة القيادة': 'licenseExpiry',
    'licenseexpiry': 'licenseExpiry',
  }

  const parseExcel = (file) => {
    setXlsxError('')
    setImportResult(null)
    setDupCount(0)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (json.length === 0) {
          setXlsxError('الملف فارغ')
          return
        }

        const mapped = json.map(row => {
          const obj = {}
          for (const [key, val] of Object.entries(row)) {
            const mk = COLUMN_MAP[key.trim().toLowerCase()] || COLUMN_MAP[key.trim()]
            if (mk) {
              if ((mk === 'birthDate' || mk === 'nationalIdExpiry' || mk === 'licenseExpiry') && val) {
                const d = val instanceof Date ? val : new Date(val)
                obj[mk] = isNaN(d) ? '' : d.toISOString().split('T')[0]
              } else {
                obj[mk] = String(val).trim()
              }
            }
          }
          return obj
        })

        const withName = mapped.filter(r => r.name)
        if (withName.length === 0) {
          setXlsxError('لم يتم التعرف على عمود "اسم السائق"')
          return
        }

        const seen = new Set()
        const unique = []
        let dups = 0

        for (const row of withName) {
          const k = row.name.trim().toLowerCase()
          if (seen.has(k)) dups++
          else {
            seen.add(k)
            unique.push(row)
          }
        }

        setDupCount(dups)
        setXlsxRows(unique)
      } catch {
        setXlsxError('خطأ في قراءة الملف')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) parseExcel(file)
  }

  const handleImport = async () => {
    if (!xlsxRows.length) return
    setImporting(true)
    try {
      const { data } = await axios.post('/api/drivers/bulk', { rows: xlsxRows }, { headers })
      setImportResult(data)
      if (data.success > 0 && hasSearched) fetchDrivers(searchInput || '', !searchInput)
    } catch (err) {
      setXlsxError(err.response?.data?.message || 'خطأ في الاستيراد')
    } finally {
      setImporting(false)
    }
  }

  const closeXlsx = () => {
    setXlsxModal(false)
    setXlsxRows([])
    setXlsxError('')
    setImportResult(null)
    setDupCount(0)
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ar-IQ') : '—'

  const isAllSelected = allSelected
  const deleteLabel = isAllSelected ? 'حذف الكل' : `حذف المحدد (${selected.length})`

  return (
    <div>
      {toast && <div className={`vo-toast ${toast.type}`}>{toast.msg}</div>}

      <div className="vo-header">
        <div>
          <h1 className="vo-title">🧑‍✈️ السائقون</h1>
          <p className="vo-subtitle">إدارة بيانات السائقين المسجلين</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn vo-btn-cancel"
            style={{ width: 'auto', padding: '10px 18px' }}
            onClick={() => setXlsxModal(true)}
          >
            📥 رفع بيانات Excel
          </button>

          <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
            ＋ إضافة سائق جديد
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="vo-search-bar" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <span className="vo-search-icon">🔍</span>
            <input
              type="text"
              placeholder="ابحث عن اسم السائق..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="vo-search-input"
            />
            {searchInput && (
              <button className="vo-clear-search" onClick={() => setSearchInput('')}>✕</button>
            )}
          </div>

          <button
            className="btn btn-primary"
            style={{ width: 'auto', padding: '10px 22px' }}
            onClick={handleSearch}
            disabled={!searchInput.trim()}
          >
            بحث
          </button>

          <button
            className="btn vo-btn-cancel"
            style={{ width: 'auto', padding: '10px 18px' }}
            onClick={handleShowAll}
          >
            إظهار الكل
          </button>

          {hasSearched && (
            <span className="vo-count">{drivers.length} سجل</span>
          )}

          {selected.length > 0 && (
            <button
              className="btn"
              style={{ width: 'auto', padding: '10px 18px', background: '#ef4444', color: '#fff' }}
              onClick={openBulkDelete}
            >
              🗑️ {deleteLabel}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        {!hasSearched ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>🔍</span>
            <p>ابحث عن اسم السائق أو اضغط "إظهار الكل" لعرض البيانات</p>
          </div>
        ) : loading ? (
          <div className="vo-loading">
            <div className="spinner" style={{ borderTopColor: '#4f46e5' }} />
            <p>جاري التحميل...</p>
          </div>
        ) : drivers.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📭</span>
            <p>لا توجد نتائج للبحث</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleSelectAll}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </th>
                  <th>#</th>
                  <th>اسم السائق</th>
                  <th>اسم الأم الثلاثي</th>
                  <th>رقم البطاقة</th>
                  <th>نفاذ البطاقة</th>
                  <th>نوع الرخصة</th>
                  <th>نفاذ الرخصة</th>
                  <th>العنوان</th>
                  <th>الصور</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>

              <tbody>
                {drivers.map((d, idx) => (
                  <tr
                    key={d._id}
                    style={{ background: selected.includes(d._id) ? '#f0f4ff' : '' }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(d._id)}
                        onChange={() => toggleOne(d._id)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                    </td>

                    <td className="vo-idx">{idx + 1}</td>

                    <td className="vo-name">
                      <span className="vo-avatar">{d.name.charAt(0)}</span>
                      {d.name}
                    </td>

                    <td>{d.motherName || '—'}</td>
                    <td>{d.nationalId || '—'}</td>

                    <td>
                      {d.nationalIdExpiry ? (
                        <span className={isExpired(d.nationalIdExpiry) ? 'dr-expired' : 'dr-valid'}>
                          {formatDate(d.nationalIdExpiry)}
                        </span>
                      ) : '—'}
                    </td>

                    <td>{d.licenseType || '—'}</td>

                    <td>
                      {d.licenseExpiry ? (
                        <span className={isExpired(d.licenseExpiry) ? 'dr-expired' : 'dr-valid'}>
                          {formatDate(d.licenseExpiry)}
                        </span>
                      ) : '—'}
                    </td>

                    <td>{d.address || '—'}</td>

                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {[
                          { path: d.nationalIdFront, label: 'ب.أ' },
                          { path: d.nationalIdBack, label: 'ب.خ' },
                          { path: d.licenseFront, label: 'ر.أ' },
                          { path: d.licenseBack, label: 'ر.خ' },
                        ].map(({ path, label }) =>
                          path ? (
                            <img
                              key={label}
                              src={getImageUrl(path)}
                              alt={label}
                              title={label}
                              onClick={() => setPreviewImg(getImageUrl(path))}
                              style={{
                                width: 32,
                                height: 22,
                                objectFit: 'cover',
                                borderRadius: 4,
                                border: '1.5px solid #e2e8f0',
                                cursor: 'zoom-in',
                              }}
                            />
                          ) : (
                            <span
                              key={label}
                              title={label}
                              style={{
                                width: 32,
                                height: 22,
                                borderRadius: 4,
                                background: '#f1f5f9',
                                border: '1.5px dashed #cbd5e1',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 8,
                                color: '#94a3b8',
                              }}
                            >
                              {label}
                            </span>
                          )
                        )}
                      </div>
                    </td>

                    <td>
                      <div className="vo-actions">
                        <button className="vo-btn-edit" onClick={() => openEdit(d)}>✏️ تعديل</button>
                        <button className="vo-btn-delete" onClick={() => setDeleteId(d._id)}>🗑️ حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="vo-overlay" onClick={closeModal}>
          <div className="vo-modal dr-modal" onClick={e => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>{editTarget ? '✏️ تعديل بيانات السائق' : '➕ إضافة سائق جديد'}</h2>
              <button className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="dr-form-grid">
                <div className="form-group">
                  <label>اسم السائق <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="name"
                    type="text"
                    placeholder="أدخل اسم السائق"
                    value={form.name}
                    onChange={handleChange}
                    className={errors.name ? 'error' : ''}
                    autoFocus
                  />
                  {errors.name && <p className="error-msg">{errors.name}</p>}
                </div>

                <div className="form-group">
                  <label>اسم أم السائق الثلاثي <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="motherName"
                    type="text"
                    placeholder="أدخل اسم الأم الثلاثي"
                    value={form.motherName}
                    onChange={handleChange}
                    className={errors.motherName ? 'error' : ''}
                  />
                  {errors.motherName && <p className="error-msg">{errors.motherName}</p>}
                </div>

                <div className="form-group">
                  <label>
                    تاريخ الولادة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="birthDate"
                    type="date"
                    value={form.birthDate}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label>
                    رقم البطاقة الوطنية
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(12 رقم — اختياري)</span>
                  </label>
                  <input
                    name="nationalId"
                    type="text"
                    placeholder="أدخل رقم البطاقة الوطنية"
                    value={form.nationalId}
                    onChange={handleChange}
                    className={errors.nationalId ? 'error' : ''}
                    maxLength={12}
                  />
                  {errors.nationalId && <p className="error-msg">{errors.nationalId}</p>}
                </div>

                <div className="form-group">
                  <label>
                    تاريخ نفاذ البطاقة الوطنية
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="nationalIdExpiry"
                    type="date"
                    value={form.nationalIdExpiry}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 الصورة الأمامية للبطاقة الوطنية"
                    value={form.nationalIdFront}
                    onChange={val => handleImage('nationalIdFront', val)}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 الصورة الخلفية للبطاقة الوطنية"
                    value={form.nationalIdBack}
                    onChange={val => handleImage('nationalIdBack', val)}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>
                    العنوان
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="address"
                    type="text"
                    placeholder="أدخل عنوان السائق"
                    value={form.address}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label>
                    نوع رخصة القيادة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <select
                    name="licenseType"
                    value={form.licenseType}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 10,
                      fontSize: 14,
                      fontFamily: 'Arial, sans-serif',
                      background: '#f8fafc',
                      outline: 'none',
                      color: '#1e293b',
                    }}
                  >
                    {LICENSE_TYPES.map(t => (
                      <option key={t} value={t}>{t || '— اختر نوع الرخصة —'}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    تاريخ نفاذ رخصة القيادة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="licenseExpiry"
                    type="date"
                    value={form.licenseExpiry}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 الصورة الأمامية لرخصة القيادة"
                    value={form.licenseFront}
                    onChange={val => handleImage('licenseFront', val)}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 الصورة الخلفية لرخصة القيادة"
                    value={form.licenseBack}
                    onChange={val => handleImage('licenseBack', val)}
                  />
                </div>
              </div>

              <div className="vo-modal-footer">
                <button
                  type="button"
                  className="btn vo-btn-cancel"
                  onClick={closeModal}
                  disabled={saving}
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 28px' }}
                  disabled={saving}
                >
                  {saving ? '⏳ جاري الحفظ...' : '💾 حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {xlsxModal && (
        <div className="vo-overlay" onClick={closeXlsx}>
          <div className="vo-modal dr-modal" onClick={e => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>📥 رفع بيانات من Excel</h2>
              <button className="vo-modal-close" onClick={closeXlsx}>✕</button>
            </div>

            <div className="dr-xlsx-hint">
              <strong>📋 أعمدة الملف المدعومة:</strong>
              <div className="dr-cols-grid">
                {[
                  ['اسم السائق', '(مطلوب)'],
                  ['اسم الأم', '(اختياري)'],
                  ['تاريخ الولادة', '(اختياري)'],
                  ['رقم البطاقة الوطنية', '(اختياري)'],
                  ['تاريخ نفاذ البطاقة', '(اختياري)'],
                  ['العنوان', '(اختياري)'],
                  ['نوع الرخصة', '(اختياري)'],
                  ['تاريخ نفاذ الرخصة', '(اختياري)'],
                ].map(([col, req]) => (
                  <span key={col} className="dr-col-tag">{col} <em>{req}</em></span>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>اختر ملف Excel</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                style={{
                  padding: '8px',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: 10,
                  width: '100%',
                  cursor: 'pointer',
                }}
              />
            </div>

            {xlsxError && <div className="alert error">{xlsxError}</div>}

            {xlsxRows.length > 0 && !importResult && (
              <div>
                <div className="alert success" style={{ marginBottom: 10 }}>
                  ✅ سجلات فريدة جاهزة: <strong>{xlsxRows.length}</strong>
                  {dupCount > 0 && (
                    <span style={{ marginRight: 8 }}>
                      | 🔁 تم حذف <strong>{dupCount}</strong> مكرر من الملف
                    </span>
                  )}
                </div>

                <div
                  className="vo-table-wrap"
                  style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}
                >
                  <table className="vo-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>الاسم</th>
                        <th>اسم الأم</th>
                        <th>البطاقة</th>
                        <th>الرخصة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {xlsxRows.slice(0, 3).map((r, i) => (
                        <tr key={i}>
                          <td>{r.name || '—'}</td>
                          <td>{r.motherName || '—'}</td>
                          <td>{r.nationalId || '—'}</td>
                          <td>{r.licenseType || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {importResult && (
              <div style={{ margin: '12px 0' }}>
                <div className="alert success" style={{ marginBottom: 8 }}>
                  ✅ تم استيراد <strong>{importResult.success}</strong> سجل جديد
                  {importResult.skipped > 0 && (
                    <span style={{ marginRight: 8 }}>
                      | ⏭️ تخطي <strong>{importResult.skipped}</strong> موجود
                    </span>
                  )}
                  {dupCount > 0 && (
                    <span style={{ marginRight: 8 }}>
                      | 🔁 <strong>{dupCount}</strong> مكرر في الملف
                    </span>
                  )}
                </div>

                {importResult.failed > 0 && (
                  <div className="alert error">
                    ⚠️ فشل <strong>{importResult.failed}</strong> سجل:
                    <ul className="import-errors-list">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="vo-modal-footer">
              <button className="btn vo-btn-cancel" onClick={closeXlsx}>
                {importResult ? 'إغلاق' : 'إلغاء'}
              </button>

              {!importResult && (
                <button
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 28px' }}
                  onClick={handleImport}
                  disabled={importing || xlsxRows.length === 0}
                >
                  {importing ? '⏳ جاري الاستيراد...' : `📥 استيراد (${xlsxRows.length} سجل)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="vo-overlay" onClick={() => setDeleteId(null)}>
          <div className="vo-modal vo-confirm" onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
              <h3 style={{ marginBottom: 8 }}>تأكيد الحذف</h3>
              <p style={{ color: '#64748b', fontSize: 14 }}>
                هل أنت متأكد من حذف هذا السائق؟ لا يمكن التراجع.
              </p>
            </div>

            <div className="vo-modal-footer">
              <button className="btn vo-btn-cancel" onClick={() => setDeleteId(null)}>إلغاء</button>
              <button
                className="btn"
                style={{ background: '#ef4444', color: '#fff', width: 'auto', padding: '10px 28px' }}
                onClick={handleDelete}
              >
                🗑️ نعم، احذف
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModal && (
        <div className="vo-overlay" onClick={() => setBulkModal(false)}>
          <div className="vo-modal vo-confirm" onClick={e => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>🗑️ {isAllSelected ? 'حذف الكل' : 'حذف المحدد'}</h2>
              <button className="vo-modal-close" onClick={() => setBulkModal(false)}>✕</button>
            </div>

            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>⚠️</div>
              <p style={{ color: '#1e293b', fontWeight: 600, marginBottom: 6 }}>
                سيتم حذف <span style={{ color: '#ef4444' }}>{selected.length}</span> سائق بشكل نهائي
              </p>
              <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                لا يمكن التراجع عن هذا الإجراء
              </p>
              <p style={{ fontSize: 13, marginBottom: 8, color: '#475569' }}>
                اكتب كلمة <strong style={{ color: '#ef4444' }}>حذف</strong> للتأكيد:
              </p>

              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="اكتب: حذف"
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `2px solid ${confirmText === 'حذف' ? '#22c55e' : '#e2e8f0'}`,
                  fontSize: 15,
                  fontFamily: 'Arial, sans-serif',
                  textAlign: 'center',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
            </div>

            <div className="vo-modal-footer">
              <button
                className="btn vo-btn-cancel"
                onClick={() => setBulkModal(false)}
                disabled={deleting}
              >
                إلغاء
              </button>

              <button
                className="btn"
                style={{
                  background: confirmText === 'حذف' ? '#ef4444' : '#fca5a5',
                  color: '#fff',
                  width: 'auto',
                  padding: '10px 28px',
                  cursor: confirmText === 'حذف' ? 'pointer' : 'not-allowed',
                }}
                onClick={handleBulkDelete}
                disabled={confirmText !== 'حذف' || deleting}
              >
                {deleting ? '⏳ جاري الحذف...' : `🗑️ ${isAllSelected ? 'حذف الكل' : 'حذف المحدد'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImg && (
        <div
          className="vo-overlay"
          style={{ zIndex: 1200, background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setPreviewImg(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={previewImg}
              alt="معاينة"
              style={{
                maxWidth: '90vw',
                maxHeight: '85vh',
                borderRadius: 12,
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            />
            <button
              onClick={() => setPreviewImg(null)}
              style={{
                position: 'absolute',
                top: -14,
                left: -14,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
