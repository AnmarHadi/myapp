import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const governorates = [
  'بغداد',
  'البصرة',
  'نينوى',
  'أربيل',
  'الأنبار',
  'بابل',
  'كربلاء',
  'النجف',
  'ذي قار',
  'ديالى',
  'صلاح الدين',
  'كركوك',
  'واسط',
  'ميسان',
  'المثنى',
  'القادسية',
  'دهوك',
  'السليمانية',
]

const emptyForm = {
  name: '',
  governorate: '',
}

export default function UnloadingDestinations() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [openModal, setOpenModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [apiError, setApiError] = useState('')
  const [apiSuccess, setApiSuccess] = useState('')

  const token = localStorage.getItem('token')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const fetchItems = async (searchText = '') => {
    try {
      setLoading(true)
      const { data } = await axios.get('/api/unloading-destinations', {
        headers,
        params: searchText?.trim() ? { search: searchText.trim() } : {},
      })
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في جلب وجهات التفريغ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [])

  const handleOpenModal = () => {
    setForm(emptyForm)
    setApiError('')
    setApiSuccess('')
    setOpenModal(true)
  }

  const handleCloseModal = () => {
    setOpenModal(false)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setApiError('يرجى إدخال اسم وجهة التفريغ')
      return
    }

    if (!form.governorate.trim()) {
      setApiError('يرجى اختيار المحافظة')
      return
    }

    try {
      setSaving(true)
      setApiError('')
      setApiSuccess('')

      await axios.post(
        '/api/unloading-destinations',
        {
          name: form.name,
          governorate: form.governorate,
        },
        { headers }
      )

      setApiSuccess('تم حفظ وجهة التفريغ بنجاح')
      handleCloseModal()
      fetchItems(search)
    } catch (err) {
      setApiError(err.response?.data?.message || 'فشل في حفظ وجهة التفريغ')
    } finally {
      setSaving(false)
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    fetchItems(search)
  }

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div>
          <div className="pricing-kicker">📍 وجهات التفريغ</div>
          <h1 className="pricing-title">وجهات التفريغ</h1>
          <p className="pricing-subtitle">
            إدارة وجهات التفريغ وربطها بالمحافظات مع منع التكرار ضمن نفس المحافظة.
          </p>
        </div>
      </div>

      {(apiError || apiSuccess) && (
        <div className={`pricing-alert ${apiError ? 'pricing-alert-error' : 'pricing-alert-success'}`}>
          {apiError || apiSuccess}
        </div>
      )}

      <div className="pricing-card">
        <div className="pricing-card-header">
          <div>
            <h2 className="pricing-card-title">إدارة وجهات التفريغ</h2>
          </div>
        </div>

        <div className="pricing-toolbar">
          <button
            type="button"
            className="pricing-btn pricing-btn-primary"
            onClick={handleOpenModal}
          >
            إضافة وجهة تفريغ جديدة
          </button>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="pricing-input"
              placeholder="بحث بالاسم أو المحافظة"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <button type="submit" className="pricing-btn pricing-btn-secondary">
              بحث
            </button>
          </form>
        </div>

        <div className="pricing-table-wrap" style={{ marginTop: 18 }}>
          <table className="pricing-table">
            <thead>
              <tr>
                <th>اسم وجهة التفريغ</th>
                <th>المحافظة</th>
                <th>تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="3">جاري التحميل...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan="3">لا توجد بيانات</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item._id}>
                    <td>{item.name}</td>
                    <td>{item.governorate}</td>
                    <td>{new Date(item.createdAt).toLocaleDateString('ar-IQ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openModal && (
        <div className="pricing-modal-overlay">
          <div className="pricing-modal">
            <div className="pricing-modal-header">
              <h3 className="pricing-modal-title">إضافة وجهة تفريغ جديدة</h3>
            </div>

            <div className="pricing-form">
              <div className="pricing-field">
                <label className="pricing-label">ادخل اسم وجهة التفريغ</label>
                <input
                  className="pricing-input"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="مثال: معمل مصفى النفط الذهبي"
                />
              </div>

              <div className="pricing-field">
                <label className="pricing-label">المحافظة</label>
                <select
                  className="pricing-input"
                  value={form.governorate}
                  onChange={(e) => setForm((prev) => ({ ...prev, governorate: e.target.value }))}
                >
                  <option value="">اختر المحافظة</option>
                  {governorates.map((gov) => (
                    <option key={gov} value={gov}>
                      {gov}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pricing-modal-footer">
              <button
                type="button"
                className="pricing-btn pricing-btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>

              <button
                type="button"
                className="pricing-btn pricing-btn-secondary"
                onClick={handleCloseModal}
                disabled={saving}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}