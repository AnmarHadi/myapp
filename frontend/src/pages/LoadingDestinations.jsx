import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'

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
  name: '',
  governorate: '',
}

export default function LoadingDestinations() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const [toast, setToast] = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/loading-destinations', { headers })
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب وجهات التحميل', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

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
      name: item.name || '',
      governorate: item.governorate || '',
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
    setForm((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: '' }))
    setApiError('')
  }

  const validate = () => {
    const nextErrors = {}

    if (!form.name.trim()) {
      nextErrors.name = 'اسم وجهة التحميل مطلوب'
    }

    if (!form.governorate.trim()) {
      nextErrors.governorate = 'المحافظة مطلوبة'
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

    try {
      const payload = {
        name: form.name.trim(),
        governorate: form.governorate.trim(),
      }

      if (editTarget?._id) {
        await axios.put(`/api/loading-destinations/${editTarget._id}`, payload, { headers })
        showToast('تم تعديل وجهة التحميل بنجاح')
      } else {
        await axios.post('/api/loading-destinations', payload, { headers })
        showToast('تم إضافة وجهة التحميل بنجاح')
      }

      closeModal()
      fetchItems()
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ أثناء الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return

    try {
      await axios.delete(`/api/loading-destinations/${deleteId}`, { headers })
      showToast('تم حذف وجهة التحميل بنجاح')
      setDeleteId(null)
      fetchItems()
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
      setDeleteId(null)
    }
  }

  return (
    <div>
      {toast && <div className={`vo-toast ${toast.type}`}>{toast.msg}</div>}

      <div className="vo-header">
        <div>
          <h1 className="vo-title">📍 وجهات التحميل</h1>
          <p className="vo-subtitle">إدارة وجهات التحميل حسب المحافظة</p>
        </div>

        <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
          ＋ إضافة وجهة تحميل جديدة
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="vo-loading">
            <div className="spinner" style={{ borderTopColor: '#4f46e5' }} />
            <p>جاري التحميل...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📭</span>
            <p>لا توجد وجهات تحميل مضافة</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم الوجهة</th>
                  <th>المحافظة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item._id}>
                    <td className="vo-idx">{idx + 1}</td>
                    <td>{item.name}</td>
                    <td>{item.governorate}</td>
                    <td>
                      <div className="vo-actions">
                        <button type="button" className="vo-btn-edit" onClick={() => openEdit(item)}>
                          ✏️ تعديل
                        </button>
                        <button type="button" className="vo-btn-delete" onClick={() => setDeleteId(item._id)}>
                          🗑️ حذف
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
        <div className="vo-overlay" onClick={closeModal}>
          <div className="vo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>{editTarget ? '✏️ تعديل وجهة التحميل' : '➕ إضافة وجهة تحميل جديدة'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ marginBottom: 12 }}>
                {apiError}
              </div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="form-group">
                <label>ادخل اسم الوجهة الجديدة</label>
                <input
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="ادخل اسم وجهة التحميل"
                  className={errors.name ? 'error' : ''}
                />
                {errors.name && <p className="error-msg">{errors.name}</p>}
              </div>

              <div className="form-group">
                <label>المحافظة</label>
                <select
                  name="governorate"
                  value={form.governorate}
                  onChange={handleChange}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: errors.governorate ? '1.5px solid #ef4444' : '1.5px solid #e2e8f0',
                    borderRadius: 10,
                    fontSize: 14,
                    fontFamily: 'Arial, sans-serif',
                    background: '#f8fafc',
                    outline: 'none',
                    color: '#1e293b',
                  }}
                >
                  <option value="">— اختر المحافظة —</option>
                  {IRAQ_GOVERNORATES.filter(Boolean).map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                {errors.governorate && <p className="error-msg">{errors.governorate}</p>}
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

      {deleteId && (
        <div className="vo-overlay" onClick={() => setDeleteId(null)}>
          <div className="vo-modal vo-confirm" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
              <h3 style={{ marginBottom: 8 }}>تأكيد الحذف</h3>
              <p style={{ color: '#64748b', fontSize: 14 }}>
                هل أنت متأكد من حذف وجهة التحميل؟ لا يمكن التراجع.
              </p>
            </div>

            <div className="vo-modal-footer">
              <button type="button" className="btn vo-btn-cancel" onClick={() => setDeleteId(null)}>
                إلغاء
              </button>
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
