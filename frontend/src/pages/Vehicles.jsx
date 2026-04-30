import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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

const IRAQ_GOVERNORATES = [
  '',
  'بغداد',
  'البصرة',
  'نينوى',
  'أربيل',
  'النجف',
  'كربلاء',
  'الأنبار',
  'بابل',
  'ديالى',
  'دهوك',
  'ذي قار',
  'السليمانية',
  'صلاح الدين',
  'القادسية',
  'كركوك',
  'المثنى',
  'ميسان',
  'واسط',
]

const emptyForm = {
  owner: '',
  ownerName: '',
  vehicleType: '',
  driver: '',
  vehicleNumber: '',
  governorate: '',
  capacity: '',
  annualExpiry: '',
  calibrationExpiry: '',
  annualImage: null,
  calibrationImage: null,
}

const isExpired = (date) => date && new Date(date) < new Date()

const parseCombinedVehicle = (value = '') => {
  const raw = String(value).trim()
  if (!raw) return { vehicleNumber: '', governorate: '' }

  const gov = [...IRAQ_GOVERNORATES]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find(g => raw.includes(g))

  if (!gov) {
    return { vehicleNumber: raw.replace(/\s+/g, ' ').trim(), governorate: '' }
  }

  const vehicleNumber = raw
    .replace(gov, ' ')
    .replace(/[|,\/\-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { vehicleNumber, governorate: gov }
}

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([])
  const [owners, setOwners] = useState([])
  const [vehicleTypes, setVehicleTypes] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(false)
  const [ownersLoading, setOwnersLoading] = useState(false)
  const [typesLoading, setTypesLoading] = useState(false)
  const [driversLoading, setDriversLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const [ownerSearch, setOwnerSearch] = useState('')
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false)
  const ownerBoxRef = useRef(null)

  const [driverSearch, setDriverSearch] = useState('')
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false)
  const driverBoxRef = useRef(null)

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

  const fetchOwners = useCallback(async () => {
    setOwnersLoading(true)
    try {
      const { data } = await axios.get('/api/contractors', { headers })
      setOwners(data)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب المتعهدين', 'error')
    } finally {
      setOwnersLoading(false)
    }
  }, [])

  const fetchVehicleTypes = useCallback(async () => {
    setTypesLoading(true)
    try {
      const { data } = await axios.get('/api/vehicle-types', { headers })
      setVehicleTypes(data)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب أنواع المركبات', 'error')
    } finally {
      setTypesLoading(false)
    }
  }, [])

  const fetchDrivers = useCallback(async () => {
    setDriversLoading(true)
    try {
      const { data } = await axios.get('/api/drivers', { headers })
      setDrivers(Array.isArray(data) ? data : [])
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب السائقين', 'error')
    } finally {
      setDriversLoading(false)
    }
  }, [])

  const fetchVehicles = useCallback(async (search = '', showAll = false) => {
    setLoading(true)
    setSelected([])
    try {
      const url = search
        ? `/api/vehicles?search=${encodeURIComponent(search)}`
        : '/api/vehicles'
      const { data } = await axios.get(url, { headers })
      setVehicles(data)
      setHasSearched(!!search || showAll)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب البيانات', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOwners()
    fetchVehicleTypes()
    fetchDrivers()
  }, [fetchOwners, fetchVehicleTypes, fetchDrivers])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ownerBoxRef.current && !ownerBoxRef.current.contains(e.target)) {
        setOwnerDropdownOpen(false)
      }
      if (driverBoxRef.current && !driverBoxRef.current.contains(e.target)) {
        setDriverDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleSearch = () => {
    if (!searchInput.trim()) return
    fetchVehicles(searchInput.trim())
  }

  const handleShowAll = () => {
    setSearchInput('')
    fetchVehicles('', true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  const allSelected = vehicles.length > 0 && selected.length === vehicles.length
  const someSelected = selected.length > 0 && selected.length < vehicles.length

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : vehicles.map(v => v._id))
  }

  const toggleOne = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setOwnerSearch('')
    setOwnerDropdownOpen(false)
    setDriverSearch('')
    setDriverDropdownOpen(false)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const openEdit = (v) => {
    setEditTarget(v)
    setForm({
      owner: v.owner?._id || '',
      ownerName: v.ownerName || '',
      vehicleType: v.vehicleType?._id || '',
      driver: v.driver?._id || '',
      vehicleNumber: v.vehicleNumber || '',
      governorate: v.governorate || '',
      capacity: v.capacity != null ? String(v.capacity) : '',
      annualExpiry: v.annualExpiry ? v.annualExpiry.split('T')[0] : '',
      calibrationExpiry: v.calibrationExpiry ? v.calibrationExpiry.split('T')[0] : '',
      annualImage: v.annualImage ? { url: getImageUrl(v.annualImage), existing: true } : null,
      calibrationImage: v.calibrationImage ? { url: getImageUrl(v.calibrationImage), existing: true } : null,
    })
    setOwnerSearch(v.owner?.name || '')
    setOwnerDropdownOpen(false)
    setDriverSearch(v.driver?.name || '')
    setDriverDropdownOpen(false)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setForm(emptyForm)
    setOwnerSearch('')
    setOwnerDropdownOpen(false)
    setDriverSearch('')
    setDriverDropdownOpen(false)
    setErrors({})
    setApiError('')
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    if (name === 'capacity') {
      const digits = value.replace(/\D/g, '').slice(0, 5)
      setForm(p => ({ ...p, capacity: digits }))
      setErrors(p => ({ ...p, [name]: '' }))
      setApiError('')
      return
    }

    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    setErrors(p => ({ ...p, [e.target.name]: '' }))
    setApiError('')
  }

  const handleImage = (field, val) => {
    setForm(p => ({ ...p, [field]: val }))
  }

  const filteredOwners = useMemo(() => {
    const q = ownerSearch.trim().toLowerCase()
    if (!q) return owners.slice(0, 50)
    return owners
      .filter(o => String(o.name || '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [owners, ownerSearch])

  const handleOwnerInputChange = (value) => {
    setOwnerSearch(value)
    setOwnerDropdownOpen(true)
    setForm(prev => ({ ...prev, owner: '' }))
    setErrors(prev => ({ ...prev, owner: '' }))
    setApiError('')
  }

  const handleSelectOwner = (ownerObj) => {
    setForm(prev => ({ ...prev, owner: ownerObj._id }))
    setOwnerSearch(ownerObj.name || '')
    setOwnerDropdownOpen(false)
    setErrors(prev => ({ ...prev, owner: '' }))
    setApiError('')
  }

  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase()
    if (!q) return drivers.slice(0, 50)
    return drivers
      .filter(d => String(d.name || '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [drivers, driverSearch])

  const handleDriverInputChange = (value) => {
    setDriverSearch(value)
    setDriverDropdownOpen(true)
    setForm(prev => ({ ...prev, driver: '' }))
    setErrors(prev => ({ ...prev, driver: '' }))
    setApiError('')
  }

  const handleSelectDriver = (driverObj) => {
    setForm(prev => ({ ...prev, driver: driverObj._id }))
    setDriverSearch(driverObj.name || '')
    setDriverDropdownOpen(false)
    setErrors(prev => ({ ...prev, driver: '' }))
    setApiError('')
  }

  const validate = () => {
    const e = {}
    if (!form.vehicleType) e.vehicleType = 'نوع المركبة مطلوب'
    if (!form.vehicleNumber.trim()) e.vehicleNumber = 'رقم المركبة مطلوب'

    if (form.capacity) {
      if (!/^\d{1,5}$/.test(form.capacity)) {
        e.capacity = 'حمولة المركبة يجب أن تكون رقماً صحيحاً من خمس مراتب كحد أقصى'
      }
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
      fd.append('owner', form.owner || '')
      fd.append('ownerName', form.ownerName || '')
      fd.append('vehicleType', form.vehicleType)
      fd.append('driver', form.driver || '')
      fd.append('vehicleNumber', form.vehicleNumber)
      fd.append('governorate', form.governorate)
      fd.append('capacity', form.capacity || '')
      fd.append('annualExpiry', form.annualExpiry)
      fd.append('calibrationExpiry', form.calibrationExpiry)

      if (form.annualImage?.blob) {
        fd.append('annualImage', form.annualImage.blob, 'annual.jpg')
      }
      if (form.calibrationImage?.blob) {
        fd.append('calibrationImage', form.calibrationImage.blob, 'calibration.jpg')
      }

      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      }

      if (editTarget) {
        await axios.put(`/api/vehicles/${editTarget._id}`, fd, config)
        showToast('تم تعديل المركبة بنجاح ✅')
      } else {
        await axios.post('/api/vehicles', fd, config)
        showToast('تم إضافة المركبة بنجاح ✅')
      }

      closeModal()
      if (hasSearched) fetchVehicles(searchInput || '', !searchInput)
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await axios.delete(`/api/vehicles/${deleteId}`, { headers })
      showToast('تم حذف المركبة بنجاح 🗑️')
      setDeleteId(null)
      if (hasSearched) fetchVehicles(searchInput || '', !searchInput)
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
      await axios.delete('/api/vehicles/bulk', {
        headers,
        data: { ids: selected },
      })
      showToast(`تم حذف ${selected.length} مركبة بنجاح 🗑️`)
      setBulkModal(false)
      setSelected([])
      if (hasSearched) fetchVehicles(searchInput || '', !searchInput)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const COLUMN_MAP = {
    'اسم المالك': 'ownerName',
    'مالك المركبة': 'ownerName',
    owner: 'ownerName',
    ownername: 'ownerName',
    'نوع المركبة': 'vehicleTypeName',
    'vehicle type': 'vehicleTypeName',
    vehicletype: 'vehicleTypeName',
    type: 'vehicleTypeName',
    'رقم المركبة': 'vehicleNumber',
    'vehicle number': 'vehicleNumber',
    vehiclenumber: 'vehicleNumber',
    'المحافظة': 'governorate',
    governorate: 'governorate',
    'المركبة': 'vehicleCombined',
    vehicle: 'vehicleCombined',
    'رقم المركبة+المحافظة': 'vehicleCombined',
    'رقم المركبة + المحافظة': 'vehicleCombined',
    'حمولة المركبة': 'capacity',
    'الحمولة': 'capacity',
    capacity: 'capacity',
    'تاريخ نفاذ السنوية': 'annualExpiry',
    annualexpiry: 'annualExpiry',
    'تاريخ نفاذ شهادة التكييل': 'calibrationExpiry',
    calibrationexpiry: 'calibrationExpiry',
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
            if (!mk) continue

            if ((mk === 'annualExpiry' || mk === 'calibrationExpiry') && val) {
              const d = val instanceof Date ? val : new Date(val)
              obj[mk] = isNaN(d) ? '' : d.toISOString().split('T')[0]
            } else if (mk === 'capacity') {
              obj[mk] = String(val).replace(/\D/g, '').slice(0, 5)
            } else {
              obj[mk] = String(val).trim()
            }
          }

          if ((!obj.vehicleNumber || !obj.governorate) && obj.vehicleCombined) {
            const parsed = parseCombinedVehicle(obj.vehicleCombined)
            if (!obj.vehicleNumber) obj.vehicleNumber = parsed.vehicleNumber
            if (!obj.governorate) obj.governorate = parsed.governorate
          }

          return obj
        })

        const withVehicle = mapped.filter(r => r.vehicleNumber)
        if (withVehicle.length === 0) {
          setXlsxError('لم يتم التعرف على عمود "رقم المركبة" أو العمود الموحّد')
          return
        }

        const seen = new Set()
        const unique = []
        let dups = 0

        for (const row of withVehicle) {
          const key = `${(row.vehicleNumber || '').trim().toLowerCase()}__${(row.governorate || '').trim().toLowerCase()}`
          if (seen.has(key)) dups++
          else {
            seen.add(key)
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
      const rows = xlsxRows.map(row => ({
        ownerName: row.ownerName || '',
        vehicleTypeName: row.vehicleTypeName || '',
        vehicleNumber: row.vehicleNumber || '',
        governorate: row.governorate || '',
        capacity: row.capacity || '',
        annualExpiry: row.annualExpiry || '',
        calibrationExpiry: row.calibrationExpiry || '',
      }))

      const { data } = await axios.post('/api/vehicles/bulk', { rows }, { headers })
      setImportResult(data)
      if (data.success > 0 && hasSearched) fetchVehicles(searchInput || '', !searchInput)
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
          <h1 className="vo-title">🚚 المركبات</h1>
          <p className="vo-subtitle">إدارة بيانات المركبات المسجلة</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn vo-btn-cancel"
            style={{ width: 'auto', padding: '10px 18px' }}
            onClick={() => setXlsxModal(true)}
          >
            📥 رفع بيانات
          </button>

          <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
            ＋ إضافة مركبة جديدة
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="vo-search-bar" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <span className="vo-search-icon">🔍</span>
            <input
              type="text"
              placeholder="ابحث برقم المركبة أو المحافظة أو المالك أو النوع أو السائق أو الحمولة..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="vo-search-input"
            />
            {searchInput && (
              <button type="button" className="vo-clear-search" onClick={() => setSearchInput('')}>✕</button>
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
            <span className="vo-count">{vehicles.length} سجل</span>
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
            <span style={{ fontSize: 48 }}>🚚</span>
            <p>ابحث عن رقم مركبة أو اضغط "إظهار الكل" لعرض البيانات</p>
          </div>
        ) : loading ? (
          <div className="vo-loading">
            <div className="spinner" style={{ borderTopColor: '#4f46e5' }} />
            <p>جاري التحميل...</p>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📭</span>
            <p>لا توجد نتائج</p>
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
                  <th>مالك المركبة</th>
                  <th>نوع المركبة</th>
                  <th>سائق المركبة</th>
                  <th>رقم المركبة</th>
                  <th>المحافظة</th>
                  <th>الحمولة (لتر)</th>
                  <th>نفاذ السنوية</th>
                  <th>نفاذ شهادة التكييل</th>
                  <th>الصور</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v, idx) => (
                  <tr
                    key={v._id}
                    style={{ background: selected.includes(v._id) ? '#f0f4ff' : '' }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(v._id)}
                        onChange={() => toggleOne(v._id)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                    </td>

                    <td className="vo-idx">{idx + 1}</td>

                    <td>{v.owner?.name || '—'}</td>
                    <td>{v.vehicleType?.name || '—'}</td>
                    <td>{v.driver?.name || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{v.vehicleNumber}</td>
                    <td>{v.governorate || '—'}</td>
                    <td>{v.capacity != null ? `${v.capacity} لتر` : '—'}</td>

                    <td>
                      {v.annualExpiry ? (
                        <span className={isExpired(v.annualExpiry) ? 'dr-expired' : 'dr-valid'}>
                          {formatDate(v.annualExpiry)}
                        </span>
                      ) : '—'}
                    </td>

                    <td>
                      {v.calibrationExpiry ? (
                        <span className={isExpired(v.calibrationExpiry) ? 'dr-expired' : 'dr-valid'}>
                          {formatDate(v.calibrationExpiry)}
                        </span>
                      ) : '—'}
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {[
                          { path: v.annualImage, label: 'سنوية' },
                          { path: v.calibrationImage, label: 'تكييل' },
                        ].map(({ path, label }) =>
                          path ? (
                            <img
                              key={label}
                              src={getImageUrl(path)}
                              alt={label}
                              title={label}
                              onClick={() => setPreviewImg(getImageUrl(path))}
                              style={{
                                width: 40,
                                height: 24,
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
                                minWidth: 40,
                                height: 24,
                                padding: '0 6px',
                                borderRadius: 4,
                                background: '#f1f5f9',
                                border: '1.5px dashed #cbd5e1',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 9,
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
                        <button type="button" className="vo-btn-edit" onClick={() => openEdit(v)}>✏️ تعديل</button>
                        <button type="button" className="vo-btn-delete" onClick={() => setDeleteId(v._id)}>🗑️ حذف</button>
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
              <h2>{editTarget ? '✏️ تعديل بيانات المركبة' : '➕ إضافة مركبة جديدة'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="dr-form-grid">

                <div className="form-group" style={{ position: 'relative' }} ref={ownerBoxRef}>
                  <label>
                    اسم المتعهد
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={ownerSearch}
                    onChange={e => handleOwnerInputChange(e.target.value)}
                    onFocus={() => setOwnerDropdownOpen(true)}
                    placeholder={ownersLoading ? 'جاري تحميل المتعهدين...' : 'اكتب للبحث عن اسم المتعهد'}
                    className={errors.owner ? 'error' : ''}
                    autoComplete="off"
                  />
                  {ownerDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        left: 0,
                        background: '#fff',
                        border: `1.5px solid ${errors.owner ? '#ef4444' : '#e2e8f0'}`,
                        borderRadius: 10,
                        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10)',
                        maxHeight: 220,
                        overflowY: 'auto',
                        zIndex: 30,
                      }}
                    >
                      {ownersLoading ? (
                        <div style={{ padding: 12, color: '#64748b', fontSize: 14 }}>
                          جاري تحميل المتعهدين...
                        </div>
                      ) : filteredOwners.length === 0 ? (
                        <div style={{ padding: 12, color: '#64748b', fontSize: 14 }}>
                          لا يوجد متعهد مطابق
                        </div>
                      ) : (
                        filteredOwners.map(ownerItem => (
                          <button
                            key={ownerItem._id}
                            type="button"
                            onClick={() => handleSelectOwner(ownerItem)}
                            style={{
                              width: '100%',
                              textAlign: 'right',
                              border: 'none',
                              background:
                                String(form.owner) === String(ownerItem._id) ? '#eef2ff' : '#fff',
                              padding: '10px 12px',
                              cursor: 'pointer',
                              fontFamily: 'Arial, sans-serif',
                              fontSize: 14,
                              color: '#1e293b',
                              borderBottom: '1px solid #f1f5f9',
                            }}
                          >
                            {ownerItem.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>
                    اسم مالك المركبة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="ownerName"
                    type="text"
                    placeholder="أدخل اسم مالك المركبة (إن وجد)"
                    value={form.ownerName}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label>نوع المركبة <span style={{ color: 'red' }}>*</span></label>
                  <select
                    name="vehicleType"
                    value={form.vehicleType}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      border: errors.vehicleType ? '1.5px solid #ef4444' : '1.5px solid #e2e8f0',
                      borderRadius: 10,
                      fontSize: 14,
                      fontFamily: 'Arial, sans-serif',
                      background: '#f8fafc',
                      outline: 'none',
                      color: '#1e293b',
                    }}
                  >
                    <option value="">{typesLoading ? 'جاري التحميل...' : '— اختر نوع المركبة —'}</option>
                    {vehicleTypes.map(type => (
                      <option key={type._id} value={type._id}>{type.name}</option>
                    ))}
                  </select>
                  {errors.vehicleType && <p className="error-msg">{errors.vehicleType}</p>}
                </div>

                <div className="form-group" style={{ position: 'relative' }} ref={driverBoxRef}>
                  <label>
                    اختر سائق المركبة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={driverSearch}
                    onChange={e => handleDriverInputChange(e.target.value)}
                    onFocus={() => setDriverDropdownOpen(true)}
                    placeholder={driversLoading ? 'جاري تحميل السائقين...' : 'اكتب للبحث عن اسم السائق'}
                    className={errors.driver ? 'error' : ''}
                    autoComplete="off"
                  />

                  {driverDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        left: 0,
                        background: '#fff',
                        border: `1.5px solid ${errors.driver ? '#ef4444' : '#e2e8f0'}`,
                        borderRadius: 10,
                        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10)',
                        maxHeight: 220,
                        overflowY: 'auto',
                        zIndex: 30,
                      }}
                    >
                      {driversLoading ? (
                        <div style={{ padding: 12, color: '#64748b', fontSize: 14 }}>
                          جاري تحميل السائقين...
                        </div>
                      ) : filteredDrivers.length === 0 ? (
                        <div style={{ padding: 12, color: '#64748b', fontSize: 14 }}>
                          لا يوجد سائق مطابق
                        </div>
                      ) : (
                        filteredDrivers.map(driverItem => (
                          <button
                            key={driverItem._id}
                            type="button"
                            onClick={() => handleSelectDriver(driverItem)}
                            style={{
                              width: '100%',
                              textAlign: 'right',
                              border: 'none',
                              background:
                                String(form.driver) === String(driverItem._id) ? '#eef2ff' : '#fff',
                              padding: '10px 12px',
                              cursor: 'pointer',
                              fontFamily: 'Arial, sans-serif',
                              fontSize: 14,
                              color: '#1e293b',
                              borderBottom: '1px solid #f1f5f9',
                            }}
                          >
                            {driverItem.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {errors.driver && <p className="error-msg">{errors.driver}</p>}
                </div>

                <div className="form-group">
                  <label>رقم المركبة <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="vehicleNumber"
                    type="text"
                    placeholder="أدخل رقم المركبة"
                    value={form.vehicleNumber}
                    onChange={handleChange}
                    className={errors.vehicleNumber ? 'error' : ''}
                  />
                  {errors.vehicleNumber && <p className="error-msg">{errors.vehicleNumber}</p>}
                </div>

                <div className="form-group">
                  <label>
                    المحافظة
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <select
                    name="governorate"
                    value={form.governorate}
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
                    {IRAQ_GOVERNORATES.map(g => (
                      <option key={g || 'none'} value={g}>{g || '— بدون محافظة —'}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    حمولة المركبة (لتر)
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="capacity"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="مثال: 30000"
                    value={form.capacity}
                    onChange={handleChange}
                    className={errors.capacity ? 'error' : ''}
                  />
                  {errors.capacity && <p className="error-msg">{errors.capacity}</p>}
                </div>

                <div className="form-group">
                  <label>
                    تاريخ نفاذ السنوية
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="annualExpiry"
                    type="date"
                    value={form.annualExpiry}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 صورة السنوية"
                    value={form.annualImage}
                    onChange={val => handleImage('annualImage', val)}
                  />
                </div>

                <div className="form-group">
                  <label>
                    تاريخ نفاذ شهادة التكييل
                    <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
                  </label>
                  <input
                    name="calibrationExpiry"
                    type="date"
                    value={form.calibrationExpiry}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <DocImageField
                    label="📸 صورة شهادة التكييل"
                    value={form.calibrationImage}
                    onChange={val => handleImage('calibrationImage', val)}
                  />
                </div>
              </div>

              <div className="vo-modal-footer">
                <button type="button" className="btn vo-btn-cancel" onClick={closeModal} disabled={saving}>
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
              <h2>📥 رفع بيانات المركبات</h2>
              <button type="button" className="vo-modal-close" onClick={closeXlsx}>✕</button>
            </div>

            <div className="dr-xlsx-hint">
              <strong>📋 الأعمدة المدعومة:</strong>
              <div className="dr-cols-grid">
                {[
                  ['اسم المالك', '(اختياري)'],
                  ['نوع المركبة', '(اختياري)'],
                  ['رقم المركبة', '(مطلوب)'],
                  ['المحافظة', '(اختياري)'],
                  ['حمولة المركبة', '(اختياري)'],
                  ['رقم المركبة + المحافظة', '(بديل)'],
                  ['تاريخ نفاذ السنوية', '(اختياري)'],
                  ['تاريخ نفاذ شهادة التكييل', '(اختياري)'],
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
                  {dupCount > 0 && <span style={{ marginRight: 8 }}>| 🔁 تم حذف <strong>{dupCount}</strong> مكرر من الملف</span>}
                </div>

                <div className="vo-table-wrap" style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table className="vo-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>المالك</th>
                        <th>النوع</th>
                        <th>رقم المركبة</th>
                        <th>المحافظة</th>
                        <th>الحمولة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {xlsxRows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td>{r.ownerName || '—'}</td>
                          <td>{r.vehicleTypeName || '—'}</td>
                          <td>{r.vehicleNumber || '—'}</td>
                          <td>{r.governorate || '—'}</td>
                          <td>{r.capacity ? `${r.capacity} لتر` : '—'}</td>
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
                  {importResult.skipped > 0 && <span style={{ marginRight: 8 }}>| ⏭️ تخطي <strong>{importResult.skipped}</strong> موجود</span>}
                  {dupCount > 0 && <span style={{ marginRight: 8 }}>| 🔁 <strong>{dupCount}</strong> مكرر في الملف</span>}
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
              <button type="button" className="btn vo-btn-cancel" onClick={closeXlsx}>
                {importResult ? 'إغلاق' : 'إلغاء'}
              </button>

              {!importResult && (
                <button
                  type="button"
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
              <p style={{ color: '#64748b', fontSize: 14 }}>هل أنت متأكد من حذف هذه المركبة؟ لا يمكن التراجع.</p>
            </div>

            <div className="vo-modal-footer">
              <button type="button" className="btn vo-btn-cancel" onClick={() => setDeleteId(null)}>إلغاء</button>
              <button
                type="button"
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
              <button type="button" className="vo-modal-close" onClick={() => setBulkModal(false)}>✕</button>
            </div>

            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>⚠️</div>
              <p style={{ color: '#1e293b', fontWeight: 600, marginBottom: 6 }}>
                سيتم حذف <span style={{ color: '#ef4444' }}>{selected.length}</span> مركبة بشكل نهائي
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
              <button type="button" className="btn vo-btn-cancel" onClick={() => setBulkModal(false)} disabled={deleting}>
                إلغاء
              </button>
              <button
                type="button"
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
              type="button"
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
