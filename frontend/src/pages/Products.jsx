import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'

export default function Products() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [productName, setProductName] = useState('')
  const [error, setError] = useState('')
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [toast, setToast] = useState('')

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}` }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/products', { headers })
      setItems(data)
    } catch (err) {
      setToast(err.response?.data?.message || 'حدث خطأ في جلب المنتجات')
      window.clearTimeout(window.__productsToastTimer)
      window.__productsToastTimer = window.setTimeout(() => setToast(''), 3000)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const openModal = () => {
    setEditTarget(null)
    setProductName('')
    setError('')
    setApiError('')
    setModalOpen(true)
  }

  const openEditModal = (item) => {
    setEditTarget(item)
    setProductName(item.name || '')
    setError('')
    setApiError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setProductName('')
    setError('')
    setApiError('')
  }

  const handleSave = async (e) => {
    e.preventDefault()

    if (!productName.trim()) {
      setError('اكتب اسم المنتج أولاً')
      return
    }

    setSaving(true)
    setApiError('')
    try {
      if (editTarget) {
        await axios.put(`/api/products/${editTarget._id}`, { name: productName.trim() }, { headers })
        setToast(`تم تعديل المنتج: ${productName.trim()}`)
      } else {
        await axios.post('/api/products', { name: productName.trim() }, { headers })
        setToast(`تم حفظ المنتج: ${productName.trim()}`)
      }
      closeModal()
      fetchItems()
      window.clearTimeout(window.__productsToastTimer)
      window.__productsToastTimer = window.setTimeout(() => setToast(''), 3000)
    } catch (err) {
      setApiError(err.response?.data?.message || 'تعذر حفظ المنتج')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return

    try {
      await axios.delete(`/api/products/${deleteId}`, { headers })
      setToast('تم حذف المنتج بنجاح')
      setDeleteId(null)
      fetchItems()
      window.clearTimeout(window.__productsToastTimer)
      window.__productsToastTimer = window.setTimeout(() => setToast(''), 3000)
    } catch (err) {
      setToast(err.response?.data?.message || 'تعذر حذف المنتج')
      setDeleteId(null)
      window.clearTimeout(window.__productsToastTimer)
      window.__productsToastTimer = window.setTimeout(() => setToast(''), 3000)
    }
  }

  return (
    <div className="products-page">
      {toast && <div className="vo-toast success">{toast}</div>}

      <div className="vo-header">
        <div>
          <h1 className="vo-title">المنتجات</h1>
          <p className="vo-subtitle">إدارة قائمة المنتجات وتعريفها بسرعة</p>
        </div>

        <button type="button" className="btn btn-primary vo-add-btn" onClick={openModal}>
          + إضافة منتج جديد
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
            <span style={{ fontSize: 48 }}>📦</span>
            <p>لا توجد منتجات محفوظة بعد</p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم المنتج</th>
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
                        <button type="button" className="vo-btn-edit" onClick={() => openEditModal(item)}>
                          تعديل
                        </button>
                        <button type="button" className="vo-btn-delete" onClick={() => setDeleteId(item._id)}>
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
        <div className="vo-overlay" onClick={closeModal}>
          <div className="vo-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="vo-modal-header">
              <h2>{editTarget ? 'تعديل منتج' : 'إضافة منتج جديد'}</h2>
              <button type="button" className="vo-modal-close" onClick={closeModal}>✕</button>
            </div>

            {apiError && (
              <div className="alert error" style={{ margin: '0 0 12px' }}>{apiError}</div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="form-group">
                <label>اكتب اسم المنتج</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => {
                    setProductName(e.target.value)
                    setError('')
                  }}
                  placeholder="مثال: زيت وقود"
                  autoFocus
                  className={error ? 'error' : ''}
                />
                {error && <p className="error-msg">{error}</p>}
              </div>

              <div className="vo-modal-footer">
                <button type="button" className="btn vo-btn-cancel" onClick={closeModal}>
                  الغاء
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 28px' }}
                  disabled={saving}
                >
                  {saving ? 'جاري الحفظ...' : editTarget ? 'حفظ التعديل' : 'حفظ'}
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
                هل أنت متأكد من حذف هذا المنتج؟ لا يمكن التراجع بعد الحذف.
              </p>
            </div>

            <div className="vo-modal-footer">
              <button type="button" className="btn vo-btn-cancel" onClick={() => setDeleteId(null)}>
                الغاء
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: '#ef4444', color: '#fff', width: 'auto', padding: '10px 28px' }}
                onClick={handleDelete}
              >
                نعم، احذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
