import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const pricingTypeLabels = {
  liter: 'باللتر',
  ton: 'بالطن',
  fixed: 'نقلة مقطوعة',
  capacityRange: 'حسب الحمولة',
}

function getPageTitle(mode) {
  return mode === 'loading' ? 'تحميل داخل المعمل' : 'تفريغ داخل المعمل'
}

function getModalTitle(mode, type, isEdit = false) {
  const prefix = isEdit ? 'تعديل' : 'إضافة'

  if (type === 'liter') return `${prefix} سعر نقلة جديدة باللتر`
  if (type === 'ton') return `${prefix} سعر نقلة جديدة بالطن`
  if (type === 'fixed') return `${prefix} سعر نقلة جديدة مقطوعة`
  if (type === 'capacityRange') return `${prefix} سعر نقلة حسب الحمولة`

  return `${prefix} سعر جديد`
}

const emptyForm = {
  loadingWarehouse: '',
  price: '',
  advance: '',
  capacityFrom: '',
  capacityTo: '',
}

export default function TripPricing({ mode = 'unloading' }) {
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('')
  const [editingItem, setEditingItem] = useState(null)

  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const token = localStorage.getItem('token')
  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const pageTitle = getPageTitle(mode)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [warehouseRes, itemsRes] = await Promise.all([
        axios.get('/api/loading-warehouses', { headers }),
        axios.get(`/api/trip-pricing?operationType=${mode}`, { headers }),
      ])

      setWarehouses(Array.isArray(warehouseRes.data) ? warehouseRes.data : [])
      setItems(Array.isArray(itemsRes.data) ? itemsRes.data : [])
    } catch (err) {
      setApiError(err.response?.data?.message || 'تعذر جلب البيانات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [mode])

  const openAddModal = (type) => {
    setModalType(type)
    setEditingItem(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const openEditModal = (item) => {
    setModalType(item.pricingType)
    setEditingItem(item)
    setForm({
      loadingWarehouse: item.loadingWarehouse?._id || '',
      price: item.price ?? '',
      advance: item.advance ?? '',
      capacityFrom: item.capacityFrom ?? '',
      capacityTo: item.capacityTo ?? '',
    })
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setModalType('')
    setEditingItem(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    if (['price', 'advance', 'capacityFrom', 'capacityTo'].includes(name)) {
      const cleaned = value.replace(/[^\d.]/g, '')
      setForm((prev) => ({ ...prev, [name]: cleaned }))
    } else {
      setForm((prev) => ({ ...prev, [name]: value }))
    }

    setErrors((prev) => ({ ...prev, [name]: '' }))
    setApiError('')
  }

  const validate = () => {
    const nextErrors = {}

    if (!form.loadingWarehouse) {
      nextErrors.loadingWarehouse = 'مستودع التحميل مطلوب'
    }

    if (modalType === 'capacityRange') {
      if (form.capacityFrom === '') nextErrors.capacityFrom = 'الحمولة من مطلوبة'
      if (form.capacityTo === '') nextErrors.capacityTo = 'الحمولة إلى مطلوبة'
      if (form.price === '') nextErrors.price = 'سعر النقلة مطلوب'

      const from = Number(form.capacityFrom)
      const to = Number(form.capacityTo)

      if (
        form.capacityFrom !== '' &&
        form.capacityTo !== '' &&
        !Number.isNaN(from) &&
        !Number.isNaN(to) &&
        to < from
      ) {
        nextErrors.capacityTo = 'يجب أن تكون الحمولة إلى أكبر من أو تساوي الحمولة من'
      }
    } else {
      if (form.price === '') nextErrors.price = 'السعر مطلوب'
      if (form.advance === '') nextErrors.advance = 'السلفة مطلوبة'
    }

    return nextErrors
  }

  const handleSave = async (e) => {
    e.preventDefault()

    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setSaving(true)
    setApiError('')

    const payload = {
      operationType: mode,
      pricingType: modalType,
      loadingWarehouse: form.loadingWarehouse,
      price: form.price === '' ? null : Number(form.price),
      advance: modalType === 'capacityRange' ? null : Number(form.advance),
      capacityFrom: modalType === 'capacityRange' ? Number(form.capacityFrom) : null,
      capacityTo: modalType === 'capacityRange' ? Number(form.capacityTo) : null,
    }

    try {
      if (editingItem?._id) {
        await axios.put(`/api/trip-pricing/${editingItem._id}`, payload, { headers })
      } else {
        await axios.post('/api/trip-pricing', payload, { headers })
      }

      closeModal()
      fetchData()
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في حفظ البيانات')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    const confirmed = window.confirm('هل أنت متأكد من حذف هذا السعر؟')
    if (!confirmed) return

    try {
      await axios.delete(`/api/trip-pricing/${id}`, { headers })
      fetchData()
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في حذف السعر')
    }
  }

  const renderPriceCell = (item) => {
    if (item.pricingType === 'liter') return `${item.price ?? 0} د.ع / لتر`
    if (item.pricingType === 'ton') return `${item.price ?? 0} د.ع / طن`
    if (item.pricingType === 'fixed') return `${item.price ?? 0} د.ع / نقلة`
    if (item.pricingType === 'capacityRange') {
      return `${item.price ?? 0} د.ع | ${item.capacityFrom ?? 0} - ${item.capacityTo ?? 0} لتر`
    }
    return item.price ?? '—'
  }

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div>
          <div className="pricing-kicker">💰 اسعار النقلات</div>
          <h1 className="pricing-title">{pageTitle}</h1>
          <p className="pricing-subtitle">
            إدارة أسعار النقلات حسب نوع التسعير ومستودع التحميل مع إمكانية الإضافة والتعديل والحذف.
          </p>
        </div>
      </div>

      {apiError && !modalOpen && (
        <div className="pricing-alert pricing-alert-error">
          {apiError}
        </div>
      )}

      <div className="pricing-toolbar">
        <button className="pricing-btn pricing-btn-primary" onClick={() => openAddModal('liter')}>
          إضافة سعر باللتر
        </button>

        <button className="pricing-btn pricing-btn-secondary" onClick={() => openAddModal('ton')}>
          إضافة سعر بالطن
        </button>

        <button className="pricing-btn pricing-btn-secondary" onClick={() => openAddModal('fixed')}>
          إضافة سعر نقلة مقطوعة
        </button>

        <button className="pricing-btn pricing-btn-secondary" onClick={() => openAddModal('capacityRange')}>
          إضافة سعر نقلة حسب الحمولة
        </button>
      </div>

      <div className="pricing-card">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">الأسعار المسجلة</h2>
            <p className="pricing-card-subtitle">
              جميع الأسعار الخاصة بـ {pageTitle}
            </p>
          </div>

          <div className="pricing-stats">
            <span className="pricing-stat-badge">{items.length} سجل</span>
          </div>
        </div>

        {loading ? (
          <div className="pricing-empty">جاري تحميل البيانات...</div>
        ) : items.length === 0 ? (
          <div className="pricing-empty">
            لا توجد أسعار مضافة بعد
          </div>
        ) : (
          <div className="pricing-table-wrap">
            <table className="pricing-table">
              <thead>
                <tr>
                  <th>المستودع</th>
                  <th>النوع</th>
                  <th>السعر</th>
                  <th>السلفة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id}>
                    <td>
                      <div className="pricing-warehouse-cell">
                        <span className="pricing-warehouse-name">
                          {item.loadingWarehouse?.name || '—'}
                        </span>
                        <span className="pricing-warehouse-gov">
                          {item.loadingWarehouse?.governorate || ''}
                        </span>
                      </div>
                    </td>

                    <td>
                      <span className={`pricing-badge pricing-badge-${item.pricingType}`}>
                        {pricingTypeLabels[item.pricingType] || item.pricingType}
                      </span>
                    </td>

                    <td>{renderPriceCell(item)}</td>

                    <td>
                      {item.pricingType === 'capacityRange'
                        ? '—'
                        : `${item.advance ?? 0} د.ع`}
                    </td>

                    <td>
                      <div className="pricing-actions">
                        <button
                          className="pricing-btn pricing-btn-table-edit"
                          onClick={() => openEditModal(item)}
                        >
                          تعديل
                        </button>

                        <button
                          className="pricing-btn pricing-btn-table-delete"
                          onClick={() => handleDelete(item._id)}
                        >
                          حذف
                        </button>
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
        <div className="pricing-modal-overlay" onClick={closeModal}>
          <div className="pricing-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pricing-modal-header">
              <div>
                <h3 className="pricing-modal-title">
                  {getModalTitle(mode, modalType, !!editingItem)}
                </h3>
                <p className="pricing-modal-subtitle">{pageTitle}</p>
              </div>

              <button
                type="button"
                className="pricing-modal-close"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="pricing-form">
              {apiError && (
                <div className="pricing-alert pricing-alert-error">
                  {apiError}
                </div>
              )}

              <div className="pricing-field">
                <label className="pricing-label">مستودع التحميل</label>
                <select
                  name="loadingWarehouse"
                  value={form.loadingWarehouse}
                  onChange={handleChange}
                  className={errors.loadingWarehouse ? 'pricing-input pricing-input-error' : 'pricing-input'}
                >
                  <option value="">اختر مستودع التحميل</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse._id} value={warehouse._id}>
                      {warehouse.name} {warehouse.governorate ? `- ${warehouse.governorate}` : ''}
                    </option>
                  ))}
                </select>
                {errors.loadingWarehouse && (
                  <span className="pricing-error-text">{errors.loadingWarehouse}</span>
                )}
              </div>

              {modalType === 'capacityRange' ? (
                <>
                  <div className="pricing-grid-3">
                    <div className="pricing-field">
                      <label className="pricing-label">الحمولة من</label>
                      <input
                        type="text"
                        name="capacityFrom"
                        value={form.capacityFrom}
                        onChange={handleChange}
                        placeholder="مثال: 10000"
                        className={errors.capacityFrom ? 'pricing-input pricing-input-error' : 'pricing-input'}
                      />
                      {errors.capacityFrom && (
                        <span className="pricing-error-text">{errors.capacityFrom}</span>
                      )}
                    </div>

                    <div className="pricing-field">
                      <label className="pricing-label">الحمولة إلى</label>
                      <input
                        type="text"
                        name="capacityTo"
                        value={form.capacityTo}
                        onChange={handleChange}
                        placeholder="مثال: 20000"
                        className={errors.capacityTo ? 'pricing-input pricing-input-error' : 'pricing-input'}
                      />
                      {errors.capacityTo && (
                        <span className="pricing-error-text">{errors.capacityTo}</span>
                      )}
                    </div>

                    <div className="pricing-field">
                      <label className="pricing-label">سعر النقلة بالدينار العراقي</label>
                      <input
                        type="text"
                        name="price"
                        value={form.price}
                        onChange={handleChange}
                        placeholder="أدخل سعر النقلة"
                        className={errors.price ? 'pricing-input pricing-input-error' : 'pricing-input'}
                      />
                      {errors.price && (
                        <span className="pricing-error-text">{errors.price}</span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="pricing-field">
                    <label className="pricing-label">
                      {modalType === 'liter'
                        ? 'ادخل سعر اللتر الواحد بالدينار'
                        : modalType === 'ton'
                        ? 'ادخل سعر النقلة الطن بالدينار'
                        : 'ادخل سعر النقلة بالدينار العراقي'}
                    </label>
                    <input
                      type="text"
                      name="price"
                      value={form.price}
                      onChange={handleChange}
                      placeholder="أدخل السعر"
                      className={errors.price ? 'pricing-input pricing-input-error' : 'pricing-input'}
                    />
                    {errors.price && (
                      <span className="pricing-error-text">{errors.price}</span>
                    )}
                  </div>

                  <div className="pricing-field">
                    <label className="pricing-label">
                      {modalType === 'ton'
                        ? 'مبلغ السلفة بالدينار العراقي'
                        : 'ادخل مبلغ السلفة بالدينار'}
                    </label>
                    <input
                      type="text"
                      name="advance"
                      value={form.advance}
                      onChange={handleChange}
                      placeholder="أدخل مبلغ السلفة"
                      className={errors.advance ? 'pricing-input pricing-input-error' : 'pricing-input'}
                    />
                    {errors.advance && (
                      <span className="pricing-error-text">{errors.advance}</span>
                    )}
                  </div>
                </>
              )}

              <div className="pricing-modal-footer">
                <button
                  type="button"
                  className="pricing-btn pricing-btn-cancel"
                  onClick={closeModal}
                  disabled={saving}
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  className="pricing-btn pricing-btn-primary"
                  disabled={saving}
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}