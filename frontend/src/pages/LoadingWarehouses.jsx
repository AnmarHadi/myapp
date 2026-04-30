import { useEffect, useState, useCallback } from 'react'
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

const emptyForm = {
  name: '',
  governorate: '',
}

export default function LoadingWarehouses() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState(null)
  const [toast, setToast] = useState(null)

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/loading-warehouses', { headers })
      setItems(data)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب البيانات', 'error')
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
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    setErrors(p => ({ ...p, [e.target.name]: '' }))
    setApiError('')
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'اسم مستودع التحميل مطلوب'
    if (!form.governorate) e.governorate = 'المحافظة مطلوبة'
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
      if (editTarget) {
        await axios.put(`/api/loading-warehouses/${editTarget._id}`, form, { headers })
        showToast('تم تعديل مستودع التحميل بنجاح ✅')
      } else {
        await axios.post('/api/loading-warehouses', form, { headers })
        showToast('تم إضافة مستودع التحميل بنجاح ✅')
      }

      closeModal()
      fetchItems()
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await axios.delete(`/api/loading-warehouses/${deleteId}`, { headers })
      showToast('تم حذف مستودع التحميل بنجاح 🗑️')
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
          <h1 className="vo-title">🏭 مستودعات التحميل</h1>
          <p className="vo-subtitle">إدارة مستودعات التحميل حسب المحافظة</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
            ＋ إضافة مستودع تحميل جديد
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="vo-loading">
            <div className="spinner" style={{ borderTopColor: '#4f46e5' }} />
            <p>جاري التحميل...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>🏭</span>
            <p>لا توجد مستودعات تحميل مضافة حالياً</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم مستودع التحميل</th>
                  <th>المحافظة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item._id}>
                    <td className="vo-idx">{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>{item.governorate}</td>
                    <td>
                      <div className="vo-actions">
                        <button type="button" className="vo-btn-edit" onClick={() => openEdit(item)}>✏️ تعديل</button>
                        <button type="button" className="vo-btn-delete" onClick={() => setDeleteId(item._id)}>🗑️ حذف</button>
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
          <div className="vo-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>{editTarget ? '✏️ تعديل مستودع التحميل' : '➕ إضافة مستودع تحميل جديد'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="form-group">
                <label>ادخل اسم مستودع التحميل <span style={{ color: 'red' }}>*</span></label>
                <input
                  name="name"
                  type="text"
                  placeholder="مثال: مستودع الدورة"
                  value={form.name}
                  onChange={handleChange}
                  className={errors.name ? 'error' : ''}
                  autoFocus
                />
                {errors.name && <p className="error-msg">{errors.name}</p>}
              </div>

              <div className="form-group">
                <label>المحافظة <span style={{ color: 'red' }}>*</span></label>
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
                  {IRAQ_GOVERNORATES.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                {errors.governorate && <p className="error-msg">{errors.governorate}</p>}
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

      {deleteId && (
        <div className="vo-overlay" onClick={() => setDeleteId(null)}>
          <div className="vo-modal vo-confirm" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
              <h3 style={{ marginBottom: 8 }}>تأكيد الحذف</h3>
              <p style={{ color: '#64748b', fontSize: 14 }}>
                هل أنت متأكد من حذف مستودع التحميل؟ لا يمكن التراجع.
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
