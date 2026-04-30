import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

const emptyForm = { name: '' }

export default function VehicleTypes() {
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
      const { data } = await axios.get('/api/vehicle-types', { headers })
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
    setForm({ name: item.name || '' })
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
    setForm({ name: e.target.value })
    setErrors({ name: '' })
    setApiError('')
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'اسم نوع المركبة مطلوب'
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
        await axios.put(`/api/vehicle-types/${editTarget._id}`, { name: form.name }, { headers })
        showToast('تم تعديل نوع المركبة بنجاح ✅')
      } else {
        await axios.post('/api/vehicle-types', { name: form.name }, { headers })
        showToast('تم إضافة نوع المركبة بنجاح ✅')
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
      await axios.delete(`/api/vehicle-types/${deleteId}`, { headers })
      showToast('تم حذف نوع المركبة بنجاح 🗑️')
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
          <h1 className="vo-title">🏷️ نوع المركبة</h1>
          <p className="vo-subtitle">إدارة أنواع المركبات</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
            ＋ إضافة نوع مركبة جديد
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
            <span style={{ fontSize: 48 }}>🏷️</span>
            <p>لا توجد أنواع مركبات مضافة حالياً</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم نوع المركبة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item._id}>
                    <td className="vo-idx">{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>
                      <div className="vo-actions">
                        <button className="vo-btn-edit" onClick={() => openEdit(item)}>✏️ تعديل</button>
                        <button className="vo-btn-delete" onClick={() => setDeleteId(item._id)}>🗑️ حذف</button>
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
          <div className="vo-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>{editTarget ? '✏️ تعديل نوع المركبة' : '➕ إضافة نوع مركبة جديد'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="form-group">
                <label>أدخل اسم نوع المركبة <span style={{ color: 'red' }}>*</span></label>
                <input
                  name="name"
                  type="text"
                  placeholder="مثال: صهريج، شاحنة، قلاب..."
                  value={form.name}
                  onChange={handleChange}
                  className={errors.name ? 'error' : ''}
                  autoFocus
                />
                {errors.name && <p className="error-msg">{errors.name}</p>}
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
                هل أنت متأكد من حذف نوع المركبة؟ لا يمكن التراجع.
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
    </div>
  )
}