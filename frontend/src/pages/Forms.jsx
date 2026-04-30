import { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'

const IRAQ_GOVERNORATES = [
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
  'حلبجة',
]

const COPY_TYPES = ['الأولى', 'الثانية', 'الثالثة', 'طبق الأصل']

const emptyDistribution = () => ({
  governorate: '',
  loadingWarehouse: '',
  quantityLiters: '',
  copyType: '',
  receiverName: '',
})

const emptyForm = {
  number: '',
  formDate: '',
  quantityLiters: '',
  distributions: [emptyDistribution()],
}

const emptyExtension = {
  adminOrderNumber: '',
  grantedAt: new Date().toISOString().split('T')[0],
  allowedUntil: '',
  note: '',
}

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('ar-IQ') : '—')

const addMonths = (dateValue, months) => {
  const d = new Date(dateValue)
  d.setMonth(d.getMonth() + months)
  return d
}

const diffDays = (a, b) => {
  const start = new Date(a)
  const end = new Date(b)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  const ms = end - start
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

const getLatestExtension = (item) => {
  if (!item?.extensions?.length) return null
  return [...item.extensions].sort(
    (a, b) => new Date(b.allowedUntil) - new Date(a.allowedUntil)
  )[0]
}

const getAlertInfo = (item) => {
  const now = new Date()
  const latestExtension = getLatestExtension(item)

  if (latestExtension) {
    const until = new Date(latestExtension.allowedUntil)
    const days = diffDays(new Date(), until)

    if (now > until) {
      return { text: 'انتهت مدة التمديد', color: '#ef4444', bg: '#fef2f2' }
    }
    if (days <= 7) {
      return { text: 'اقترب انتهاء التمديد', color: '#f59e0b', bg: '#fffbeb' }
    }
    return { text: 'ممددة', color: '#16a34a', bg: '#f0fdf4' }
  }

  const due = addMonths(item.formDate, 2)
  const days = diffDays(new Date(), due)

  if (now > due) {
    return { text: 'مطلوب طلب تمديد', color: '#ef4444', bg: '#fef2f2' }
  }
  if (days <= 7) {
    return { text: 'اقترب موعد طلب التمديد', color: '#f59e0b', bg: '#fffbeb' }
  }
  return null
}

export default function Forms() {
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(false)
  const [warehousesLoading, setWarehousesLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState(null)
  const [toast, setToast] = useState(null)

  const [extensionModal, setExtensionModal] = useState(false)
  const [extensionTarget, setExtensionTarget] = useState(null)
  const [extensionForm, setExtensionForm] = useState(emptyExtension)
  const [extensionSaving, setExtensionSaving] = useState(false)
  const [extensionError, setExtensionError] = useState('')

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchWarehouses = useCallback(async () => {
    setWarehousesLoading(true)
    try {
      const { data } = await axios.get('/api/loading-warehouses', { headers })
      setWarehouses(data)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب مستودعات التحميل', 'error')
    } finally {
      setWarehousesLoading(false)
    }
  }, [])

  const fetchItems = useCallback(async (search = '', month = '', showAll = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      if (month) params.append('month', month)

      const url = params.toString() ? `/api/forms?${params.toString()}` : '/api/forms'
      const { data } = await axios.get(url, { headers })
      setItems(data)
      setHasSearched(!!search || !!month || showAll)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب البيانات', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWarehouses()
  }, [fetchWarehouses])

  const totalFormQuantity = round3(Number(form.quantityLiters || 0))

  const totalDistributed = useMemo(
    () => round3(form.distributions.reduce((sum, d) => sum + Number(d.quantityLiters || 0), 0)),
    [form.distributions]
  )

  const remainingQuantity = round3(totalFormQuantity - totalDistributed)

  const getMaxAllowedForRow = useCallback((index, distributionsArg = form.distributions, formQtyArg = form.quantityLiters) => {
    const totalQty = Number(formQtyArg || 0)
    const otherRowsTotal = distributionsArg.reduce((sum, row, i) => {
      if (i === index) return sum
      return sum + Number(row.quantityLiters || 0)
    }, 0)
    return round3(Math.max(0, totalQty - otherRowsTotal))
  }, [form.distributions, form.quantityLiters])

  useEffect(() => {
    if (!modalOpen) return
    if (!form.quantityLiters || Number(form.quantityLiters) <= 0) return
    if (remainingQuantity <= 0) return

    const hasBlankRow = form.distributions.some(
      (d) =>
        !d.governorate &&
        !d.loadingWarehouse &&
        !d.quantityLiters &&
        !d.copyType &&
        !d.receiverName
    )

    const last = form.distributions[form.distributions.length - 1]
    const lastComplete =
      last &&
      last.governorate &&
      last.loadingWarehouse &&
      last.quantityLiters &&
      last.copyType &&
      last.receiverName

    if (!hasBlankRow && lastComplete) {
      setForm((prev) => ({
        ...prev,
        distributions: [...prev.distributions, emptyDistribution()],
      }))
    }
  }, [modalOpen, form.quantityLiters, form.distributions, remainingQuantity])

  const handleSearch = () => {
    if (!searchInput.trim() && !monthFilter) return
    fetchItems(searchInput.trim(), monthFilter)
  }

  const handleShowAll = () => {
    setSearchInput('')
    setMonthFilter('')
    fetchItems('', '', true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const openEdit = (item) => {
    setEditTarget(item)
    setForm({
      number: item.number || '',
      formDate: item.formDate ? item.formDate.split('T')[0] : '',
      quantityLiters: item.quantityLiters || '',
      distributions: item.distributions?.length
        ? item.distributions.map((d) => ({
            governorate: d.governorate || '',
            loadingWarehouse: d.loadingWarehouse?._id || '',
            quantityLiters: d.quantityLiters || '',
            copyType: d.copyType || '',
            receiverName: d.receiverName || '',
          }))
        : [emptyDistribution()],
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
    const { name, value } = e.target

    if (name === 'quantityLiters') {
      const newTotal = Number(value || 0)
      const currentDistributed = round3(
        form.distributions.reduce((sum, d) => sum + Number(d.quantityLiters || 0), 0)
      )

      if (value !== '' && newTotal > 0 && currentDistributed > newTotal) {
        setErrors((p) => ({
          ...p,
          quantityLiters: 'كمية الاستمارة لا يمكن أن تكون أقل من مجموع الكميات المحولة الحالية',
        }))
      } else {
        setErrors((p) => ({ ...p, quantityLiters: '' }))
      }
    } else {
      setErrors((p) => ({ ...p, [name]: '' }))
    }

    setForm((p) => ({ ...p, [name]: value }))
    setApiError('')
  }

  const handleDistributionChange = (index, field, value) => {
    setForm((prev) => {
      const distributions = [...prev.distributions]
      const currentRow = distributions[index]

      if (field === 'quantityLiters') {
        const numericValue = value === '' ? '' : Number(value)
        const maxAllowed = getMaxAllowedForRow(index, distributions, prev.quantityLiters)

        if (value !== '' && numericValue < 0) {
          value = '0'
        }

        if (value !== '' && numericValue > maxAllowed) {
          value = String(maxAllowed)
        }
      }

      distributions[index] = { ...currentRow, [field]: value }

      if (field === 'governorate') {
        distributions[index].loadingWarehouse = ''
      }

      return { ...prev, distributions }
    })

    setErrors((p) => ({ ...p, distributions: '' }))
    setApiError('')
  }

  const removeDistribution = (index) => {
    setForm((prev) => {
      if (prev.distributions.length === 1) return prev
      return {
        ...prev,
        distributions: prev.distributions.filter((_, i) => i !== index),
      }
    })
  }

  const addDistribution = () => {
    if (remainingQuantity <= 0) return
    setForm((prev) => ({
      ...prev,
      distributions: [...prev.distributions, emptyDistribution()],
    }))
  }

  const validate = () => {
    const e = {}

    if (!form.number.trim()) e.number = 'رقم الاستمارة مطلوب'
    if (!form.formDate) e.formDate = 'تاريخ الاستمارة مطلوب'
    if (!form.quantityLiters || Number(form.quantityLiters) <= 0) {
      e.quantityLiters = 'كمية الاستمارة يجب أن تكون أكبر من صفر'
    }

    const validRows = form.distributions.filter(
      (d) =>
        d.governorate ||
        d.loadingWarehouse ||
        d.quantityLiters ||
        d.copyType ||
        d.receiverName
    )

    if (validRows.length === 0) {
      e.distributions = 'يجب إضافة توزيع واحد على الأقل'
      return e
    }

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]

      if (!row.governorate || !row.loadingWarehouse || !row.quantityLiters || !row.copyType || !row.receiverName) {
        e.distributions = 'يجب إكمال كل بيانات التوزيع'
        return e
      }

      if (Number(row.quantityLiters) > Number(form.quantityLiters)) {
        e.distributions = 'لا يمكن أن تكون الكمية المحولة إلى مستودع التحميل أكبر من كمية الاستمارة'
        return e
      }
    }

    const distributedTotal = round3(
      validRows.reduce((sum, d) => sum + Number(d.quantityLiters || 0), 0)
    )

    if (distributedTotal > round3(form.quantityLiters)) {
      e.distributions = 'مجموع الكميات المحولة لا يمكن أن يتجاوز كمية الاستمارة'
    } else if (distributedTotal !== round3(form.quantityLiters)) {
      e.distributions = 'مجموع الكميات المحولة يجب أن يساوي كمية الاستمارة'
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
      const payload = {
        number: form.number,
        formDate: form.formDate,
        quantityLiters: Number(form.quantityLiters),
        distributions: form.distributions
          .filter(
            (d) =>
              d.governorate &&
              d.loadingWarehouse &&
              d.quantityLiters &&
              d.copyType &&
              d.receiverName
          )
          .map((d) => ({
            governorate: d.governorate,
            loadingWarehouse: d.loadingWarehouse,
            quantityLiters: Number(d.quantityLiters),
            copyType: d.copyType,
            receiverName: d.receiverName,
          })),
      }

      if (editTarget) {
        await axios.put(`/api/forms/${editTarget._id}`, payload, { headers })
        showToast('تم تعديل الاستمارة بنجاح ✅')
      } else {
        await axios.post('/api/forms', payload, { headers })
        showToast('تم إضافة الاستمارة بنجاح ✅')
      }

      closeModal()
      if (hasSearched) {
        fetchItems(searchInput.trim(), monthFilter, !searchInput.trim() && !monthFilter)
      }
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await axios.delete(`/api/forms/${deleteId}`, { headers })
      showToast('تم حذف الاستمارة بنجاح 🗑️')
      setDeleteId(null)
      if (hasSearched) {
        fetchItems(searchInput.trim(), monthFilter, !searchInput.trim() && !monthFilter)
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
      setDeleteId(null)
    }
  }

  const openExtensionModal = (item) => {
    setExtensionTarget(item)
    setExtensionForm(emptyExtension)
    setExtensionError('')
    setExtensionModal(true)
  }

  const closeExtensionModal = () => {
    setExtensionTarget(null)
    setExtensionForm(emptyExtension)
    setExtensionError('')
    setExtensionModal(false)
  }

  const handleExtensionSave = async (e) => {
    e.preventDefault()
    setExtensionSaving(true)
    try {
      await axios.post(`/api/forms/${extensionTarget._id}/extensions`, extensionForm, { headers })
      showToast('تمت إضافة التمديد بنجاح ✅')
      closeExtensionModal()
      if (hasSearched) {
        fetchItems(searchInput.trim(), monthFilter, !searchInput.trim() && !monthFilter)
      }
    } catch (err) {
      setExtensionError(err.response?.data?.message || 'حدث خطأ أثناء الحفظ')
    } finally {
      setExtensionSaving(false)
    }
  }

  const getWarehousesByGovernorate = (governorate) =>
    warehouses.filter((w) => w.governorate === governorate)

  return (
    <div>
      {toast && <div className={`vo-toast ${toast.type}`}>{toast.msg}</div>}

      <div className="vo-header">
        <div>
          <h1 className="vo-title">📄 الاستمارات</h1>
          <p className="vo-subtitle">إدارة الاستمارات والتوزيع والتمديدات</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
            ＋ إضافة استمارة جديدة
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="vo-search-bar" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <span className="vo-search-icon">🔍</span>
            <input
              type="text"
              placeholder="ابحث برقم الاستمارة"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="vo-search-input"
            />
          </div>

          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            style={{
              padding: '10px 14px',
              border: '1.5px solid #e2e8f0',
              borderRadius: 10,
              fontFamily: 'Arial, sans-serif',
              background: '#fff',
            }}
          />

          <button
            className="btn btn-primary"
            style={{ width: 'auto', padding: '10px 22px' }}
            onClick={handleSearch}
            disabled={!searchInput.trim() && !monthFilter}
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

          {hasSearched && <span className="vo-count">{items.length} سجل</span>}
        </div>
      </div>

      <div className="card">
        {!hasSearched ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📄</span>
            <p>ابحث برقم الاستمارة أو اختر الشهر أو اضغط إظهار الكل</p>
          </div>
        ) : loading ? (
          <div className="vo-loading">
            <div className="spinner" style={{ borderTopColor: '#4f46e5' }} />
            <p>جاري التحميل...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📭</span>
            <p>لا توجد نتائج</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>رقم الاستمارة</th>
                  <th>تاريخ الاستمارة</th>
                  <th>الكمية باللتر</th>
                  <th>التوزيعات</th>
                  <th>التمديدات</th>
                  <th>التنبيه</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const alertInfo = getAlertInfo(item)
                  return (
                    <tr key={item._id}>
                      <td className="vo-idx">{idx + 1}</td>
                      <td style={{ fontWeight: 700 }}>{item.number}</td>
                      <td>{formatDate(item.formDate)}</td>
                      <td>{item.quantityLiters}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {item.distributions?.map((d) => (
                            <div
                              key={d._id}
                              style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: '6px 8px',
                                background: '#f8fafc',
                                fontSize: 12,
                              }}
                            >
                              <div><strong>{d.loadingWarehouse?.name || '—'}</strong> - {d.governorate}</div>
                              <div>{d.quantityLiters} لتر | {d.copyType} | {d.receiverName}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        {item.extensions?.length ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {item.extensions.map((ex) => (
                              <div
                                key={ex._id}
                                style={{
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 8,
                                  padding: '6px 8px',
                                  background: '#fff',
                                  fontSize: 12,
                                }}
                              >
                                <div>الأمر: <strong>{ex.adminOrderNumber}</strong></div>
                                <div>من {formatDate(ex.grantedAt)} إلى {formatDate(ex.allowedUntil)}</div>
                              </div>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                      <td>
                        {alertInfo ? (
                          <span
                            style={{
                              background: alertInfo.bg,
                              color: alertInfo.color,
                              padding: '6px 10px',
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              display: 'inline-block',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {alertInfo.text}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <div className="vo-actions" style={{ flexWrap: 'wrap' }}>
                          <button type="button" className="vo-btn-edit" onClick={() => openEdit(item)}>✏️ تعديل</button>
                          <button
                            type="button"
                            className="btn"
                            style={{ width: 'auto', padding: '8px 12px', background: '#0ea5e9', color: '#fff' }}
                            onClick={() => openExtensionModal(item)}
                          >
                            ⏳ تمديد
                          </button>
                          <button type="button" className="vo-btn-delete" onClick={() => setDeleteId(item._id)}>🗑️ حذف</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="vo-overlay" onClick={closeModal}>
          <div
            className="vo-modal dr-modal"
            style={{
              width: '92vw',
              maxWidth: '92vw',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vo-modal-header">
              <h2>{editTarget ? '✏️ تعديل الاستمارة' : '➕ إضافة استمارة جديدة'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>}
            {errors.distributions && <div className="alert error" style={{ margin: '0 0 12px' }}>{errors.distributions}</div>}

            <form onSubmit={handleSave} noValidate>
              <div className="dr-form-grid">
                <div className="form-group">
                  <label>ادخل رقم الاستمارة <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="number"
                    value={form.number}
                    onChange={handleChange}
                    placeholder="مثال: 12345"
                    className={errors.number ? 'error' : ''}
                  />
                  {errors.number && <p className="error-msg">{errors.number}</p>}
                </div>

                <div className="form-group">
                  <label>تاريخ الاستمارة <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="formDate"
                    type="date"
                    value={form.formDate}
                    onChange={handleChange}
                    className={errors.formDate ? 'error' : ''}
                  />
                  {errors.formDate && <p className="error-msg">{errors.formDate}</p>}
                </div>

                <div className="form-group">
                  <label>كمية الاستمارة باللتر <span style={{ color: 'red' }}>*</span></label>
                  <input
                    name="quantityLiters"
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.quantityLiters}
                    onChange={handleChange}
                    placeholder="أدخل الكمية"
                    className={errors.quantityLiters ? 'error' : ''}
                  />
                  {errors.quantityLiters && <p className="error-msg">{errors.quantityLiters}</p>}
                </div>

                <div className="form-group">
                  <label>إجمالي المحول</label>
                  <input value={`${totalDistributed} / ${totalFormQuantity || 0} لتر`} disabled />
                  {remainingQuantity > 0 && (
                    <p className="error-msg">المتبقي للتوزيع: {remainingQuantity} لتر</p>
                  )}
                  {remainingQuantity < 0 && (
                    <p className="error-msg">المجموع تجاوز كمية الاستمارة</p>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 8, marginBottom: 12, fontWeight: 700, color: '#1e293b' }}>
                تقسيم كمية الاستمارة على المستودعات
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {form.distributions.map((row, index) => {
                  const maxAllowed = getMaxAllowedForRow(index)
                  return (
                    <div
                      key={index}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        padding: 12,
                        background: '#f8fafc',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1.1fr 1.1fr 0.8fr 0.8fr 1fr auto',
                          gap: 10,
                          alignItems: 'end',
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>اختر المحافظة</label>
                          <select
                            value={row.governorate}
                            onChange={(e) => handleDistributionChange(index, 'governorate', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '11px 14px',
                              border: '1.5px solid #e2e8f0',
                              borderRadius: 10,
                              fontSize: 14,
                              fontFamily: 'Arial, sans-serif',
                              background: '#fff',
                            }}
                          >
                            <option value="">— اختر المحافظة —</option>
                            {IRAQ_GOVERNORATES.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>اختر مستودع التحميل</label>
                          <select
                            value={row.loadingWarehouse}
                            onChange={(e) => handleDistributionChange(index, 'loadingWarehouse', e.target.value)}
                            disabled={!row.governorate || warehousesLoading}
                            style={{
                              width: '100%',
                              padding: '11px 14px',
                              border: '1.5px solid #e2e8f0',
                              borderRadius: 10,
                              fontSize: 14,
                              fontFamily: 'Arial, sans-serif',
                              background: '#fff',
                            }}
                          >
                            <option value="">
                              {!row.governorate
                                ? 'اختر المحافظة أولاً'
                                : warehousesLoading
                                ? 'جاري التحميل...'
                                : '— اختر مستودع التحميل —'}
                            </option>
                            {getWarehousesByGovernorate(row.governorate).map((wh) => (
                              <option key={wh._id} value={wh._id}>{wh.name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>الكمية المحولة</label>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            max={maxAllowed}
                            value={row.quantityLiters}
                            onChange={(e) => handleDistributionChange(index, 'quantityLiters', e.target.value)}
                            placeholder="لتر"
                          />
                          <small style={{ color: '#64748b', display: 'block', marginTop: 4 }}>
                            الحد الأعلى: {maxAllowed} لتر
                          </small>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>اختر نسخة الاستمارة</label>
                          <select
                            value={row.copyType}
                            onChange={(e) => handleDistributionChange(index, 'copyType', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '11px 14px',
                              border: '1.5px solid #e2e8f0',
                              borderRadius: 10,
                              fontSize: 14,
                              fontFamily: 'Arial, sans-serif',
                              background: '#fff',
                            }}
                          >
                            <option value="">— اختر النسخة —</option>
                            {COPY_TYPES.map((copy) => (
                              <option key={copy} value={copy}>{copy}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>ادخل اسم مستلم الاستمارة</label>
                          <input
                            value={row.receiverName}
                            onChange={(e) => handleDistributionChange(index, 'receiverName', e.target.value)}
                            placeholder="اسم المستلم"
                          />
                        </div>

                        <div>
                          <button
                            type="button"
                            className="btn vo-btn-cancel"
                            style={{ width: 'auto', padding: '10px 14px' }}
                            onClick={() => removeDistribution(index)}
                            disabled={form.distributions.length === 1}
                          >
                            حذف
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {remainingQuantity > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn vo-btn-cancel"
                    style={{ width: 'auto', padding: '10px 18px' }}
                    onClick={addDistribution}
                  >
                    ＋ إضافة تقسيم آخر
                  </button>
                </div>
              )}

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

      {extensionModal && (
        <div className="vo-overlay" onClick={closeExtensionModal}>
          <div className="vo-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>⏳ تمديد الاستمارة</h2>
              <button type="button" className="vo-modal-close" onClick={closeExtensionModal}>✕</button>
            </div>

            {extensionError && <div className="alert error" style={{ marginBottom: 12 }}>{extensionError}</div>}

            <form onSubmit={handleExtensionSave}>
              <div className="dr-form-grid">
                <div className="form-group">
                  <label>رقم الأمر الإداري <span style={{ color: 'red' }}>*</span></label>
                  <input
                    value={extensionForm.adminOrderNumber}
                    onChange={(e) => setExtensionForm((p) => ({ ...p, adminOrderNumber: e.target.value }))}
                    placeholder="أدخل رقم الأمر الإداري"
                  />
                </div>

                <div className="form-group">
                  <label>تاريخ التمديد <span style={{ color: 'red' }}>*</span></label>
                  <input
                    type="date"
                    value={extensionForm.grantedAt}
                    onChange={(e) => setExtensionForm((p) => ({ ...p, grantedAt: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>مسموح لغاية <span style={{ color: 'red' }}>*</span></label>
                  <input
                    type="date"
                    value={extensionForm.allowedUntil}
                    onChange={(e) => setExtensionForm((p) => ({ ...p, allowedUntil: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>ملاحظة</label>
                  <input
                    value={extensionForm.note}
                    onChange={(e) => setExtensionForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder="اختياري"
                  />
                </div>
              </div>

              <div className="vo-modal-footer">
                <button type="button" className="btn vo-btn-cancel" onClick={closeExtensionModal} disabled={extensionSaving}>
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 28px' }}
                  disabled={extensionSaving}
                >
                  {extensionSaving ? '⏳ جاري الحفظ...' : '💾 حفظ التمديد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="vo-overlay" onClick={() => setDeleteId(null)}>
          <div className="vo-modal vo-confirm" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
              <h3 style={{ marginBottom: 8 }}>تأكيد الحذف</h3>
              <p style={{ color: '#64748b', fontSize: 14 }}>
                هل أنت متأكد من حذف هذه الاستمارة؟ لا يمكن التراجع.
              </p>
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
    </div>
  )
}
