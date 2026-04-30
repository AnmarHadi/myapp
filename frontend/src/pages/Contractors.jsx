import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const emptyForm = { name: '', address: '', phone: '' }

export default function Contractors() {
  const [contractors, setContractors] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
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
    setTimeout(() => setToast(null), 3000)
  }

  // جلب البيانات
  const fetchContractors = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await axios.get('/api/contractors', { headers })
      setContractors(data)
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في جلب البيانات', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchContractors() }, [fetchContractors])

  // فتح مودال الإضافة
  const openAdd = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setErrors({})
    setApiError('')
    setModalOpen(true)
  }

  // فتح مودال التعديل
  const openEdit = (contractor) => {
    setEditTarget(contractor)
    setForm({
      name: contractor.name,
      address: contractor.address,
      phone: contractor.phone,
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
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }))
    setErrors((p) => ({ ...p, [e.target.name]: '' }))
    setApiError('')
  }

  // التحقق من الصحة
  const validate = () => {
    const e = {}
    if (!form.name.trim()) {
      e.name = 'اسم المتعهد مطلوب'
    }
    if (!form.phone.trim()) {
      e.phone = 'رقم الهاتف مطلوب'
    } else if (!/^07\d{9}$/.test(form.phone.trim())) {
      e.phone = 'رقم الهاتف يجب أن يتكون من 11 رقماً ويبدأ بـ 07'
    }
    return e
  }

  // حفظ (إضافة أو تعديل)
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
        await axios.put(`/api/contractors/${editTarget._id}`, form, { headers })
        showToast('تم تعديل المتعهد بنجاح ✅')
      } else {
        await axios.post('/api/contractors', form, { headers })
        showToast('تم إضافة المتعهد بنجاح ✅')
      }
      closeModal()
      fetchContractors()
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  // حذف
  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await axios.delete(`/api/contractors/${deleteId}`, { headers })
      showToast('تم حذف المتعهد بنجاح 🗑️')
      setDeleteId(null)
      fetchContractors()
    } catch (err) {
      showToast(err.response?.data?.message || 'خطأ في الحذف', 'error')
      setDeleteId(null)
    }
  }

  // فلترة البحث
  const filtered = contractors.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.address.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`vo-toast ${toast.type}`}>{toast.msg}</div>
      )}

      {/* رأس الصفحة */}
      <div className="vo-header">
        <div>
          <h1 className="vo-title">🚗 المتعهدون</h1>
          <p className="vo-subtitle">إدارة بيانات المتعهدين المسجلين</p>
        </div>
        <button className="btn btn-primary vo-add-btn" onClick={openAdd}>
          ＋ إضافة متعهد جديد
        </button>
      </div>

      {/* بطاقة الجدول */}
      <div className="card">
        {/* شريط البحث */}
        <div className="vo-search-bar">
          <span className="vo-search-icon">🔍</span>
          <input
            type="text"
            placeholder="بحث بالاسم أو الهاتف أو العنوان..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="vo-search-input"
          />
          {search && (
            <button
              className="vo-clear-search"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
          <span className="vo-count">{filtered.length} سجل</span>
        </div>

        {/* الجدول */}
        {loading ? (
          <div className="vo-loading">
            <div
              className="spinner"
              style={{ borderTopColor: '#4f46e5' }}
            />
            <p>جاري التحميل...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="vo-empty">
            <span style={{ fontSize: 48 }}>📭</span>
            <p>
              {search
                ? 'لا توجد نتائج للبحث'
                : 'لا توجد بيانات، أضف متعهد جديد'}
            </p>
          </div>
        ) : (
          <div className="vo-table-wrap">
            <table className="vo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم المتعهد</th>
                  <th>رقم الهاتف</th>
                  <th>العنوان</th>
                  <th>تاريخ الإضافة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contractor, idx) => (
                  <tr key={contractor._id}>
                    <td className="vo-idx">{idx + 1}</td>
                    <td className="vo-name">
                      <span className="vo-avatar">
                        {contractor.name.charAt(0)}
                      </span>
                      {contractor.name}
                    </td>
                    <td>{contractor.phone || '—'}</td>
                    <td>{contractor.address || '—'}</td>
                    <td>
                      {new Date(
                        contractor.createdAt
                      ).toLocaleDateString('ar-IQ')}
                    </td>
                    <td>
                      <div className="vo-actions">
                        <button
                          className="vo-btn-edit"
                          onClick={() => openEdit(contractor)}
                        >
                          ✏️ تعديل
                        </button>
                        <button
                          className="vo-btn-delete"
                          onClick={() => setDeleteId(contractor._id)}
                        >
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

      {/* ===== مودال الإضافة / التعديل ===== */}
      {modalOpen && (
        <div className="vo-overlay" onClick={closeModal}>
          <div
            className="vo-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vo-modal-header">
              <h2>
                {editTarget
                  ? '✏️ تعديل بيانات المتعهد'
                  : '➕ إضافة متعهد جديد'}
              </h2>
              <button
                className="vo-modal-close"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>

            {apiError && (
              <div
                className="alert error"
                style={{ margin: '0 0 12px' }}
              >
                {apiError}
              </div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="form-group">
                <label>
                  اسم المتعهد{' '}
                  <span style={{ color: 'red' }}>*</span>
                </label>
                <input
                  name="name"
                  type="text"
                  placeholder="أدخل اسم المتعهد"
                  value={form.name}
                  onChange={handleChange}
                  className={errors.name ? 'error' : ''}
                  autoFocus
                />
                {errors.name && (
                  <p className="error-msg">{errors.name}</p>
                )}
              </div>

              <div className="form-group">
                <label>عنوان المتعهد</label>
                <input
                  name="address"
                  type="text"
                  placeholder="أدخل عنوان المتعهد"
                  value={form.address}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>
                  رقم هاتف المتعهد{' '}
                  <span style={{ color: 'red' }}>*</span>
                  <span
                    style={{
                      color: '#94a3b8',
                      fontSize: 11,
                      marginRight: 6,
                    }}
                  >
                    (11 رقم يبدأ بـ 07)
                  </span>
                </label>
                <input
                  name="phone"
                  type="text"
                  placeholder="مثال: 07701234567"
                  value={form.phone}
                  onChange={handleChange}
                  className={errors.phone ? 'error' : ''}
                  maxLength={11}
                />
                {errors.phone && (
                  <p className="error-msg">{errors.phone}</p>
                )}
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
                  style={{ width: 'auto', paddingInline: 28 }}
                  disabled={saving}
                >
                  {saving ? '⏳ جاري الحفظ...' : '💾 حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== مودال تأكيد الحذف ===== */}
      {deleteId && (
        <div
          className="vo-overlay"
          onClick={() => setDeleteId(null)}
        >
          <div
            className="vo-modal vo-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                textAlign: 'center',
                padding: '8px 0 20px',
              }}
            >
              <div style={{ fontSize: 52, marginBottom: 12 }}>
                ⚠️
              </div>
              <h3
                style={{ marginBottom: 8, fontSize: 18 }}
              >
                تأكيد الحذف
              </h3>
              <p
                style={{
                  color: '#64748b',
                  fontSize: 14,
                }}
              >
                هل أنت متأكد من حذف هذا المتعهد؟ لا يمكن التراجع عن
                هذا الإجراء.
              </p>
            </div>
            <div className="vo-modal-footer">
              <button
                className="btn vo-btn-cancel"
                onClick={() => setDeleteId(null)}
              >
                إلغاء
              </button>
              <button
                className="btn"
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  width: 'auto',
                  paddingInline: 28,
                }}
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