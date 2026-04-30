import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const DashboardIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 13h7V4H4zM13 20h7v-9h-7zM13 11h7V4h-7zM4 20h7v-5H4z" />
  </svg>
)

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="8" r="3" />
    <path d="M4 19a5 5 0 0 1 10 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M14.5 19a4.5 4.5 0 0 1 5-4.3" />
  </svg>
)

const WarehouseIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 10.5 12 4l9 6.5V20H3z" />
    <path d="M9 20v-5h6v5" />
  </svg>
)

const VehicleTypeIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="6" width="16" height="10" rx="2" />
    <path d="M7 19h.01M17 19h.01" />
  </svg>
)

const DriverIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="7.5" r="3" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
)

const VehicleIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M5 16V9.5A2.5 2.5 0 0 1 7.5 7h9A2.5 2.5 0 0 1 19 9.5V16" />
    <path d="M3 16h18" />
    <circle cx="7.5" cy="17.5" r="1.5" />
    <circle cx="16.5" cy="17.5" r="1.5" />
  </svg>
)

const FormIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 12h6M10 16h6" />
  </svg>
)

const ImageDataIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="m8 14 2.5-2.5L13 14l3-3 2 2" />
    <circle cx="9" cy="9" r="1.25" />
  </svg>
)

const TemplateIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M6 4h12v16H6z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
)

const PricingIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3v18M16.5 7.5c0-1.9-1.8-3.5-4.5-3.5S7.5 5.6 7.5 7.5 9.3 11 12 11s4.5 1.6 4.5 3.5S14.7 18 12 18s-4.5-1.6-4.5-3.5" />
  </svg>
)

const LocationIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 21s6-4.8 6-10a6 6 0 1 0-12 0c0 5.2 6 10 6 10Z" />
    <circle cx="12" cy="11" r="2.5" />
  </svg>
)

const UnloadingIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 4v10" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 20h14" />
  </svg>
)

const DispatchIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 7h11v10H4z" />
    <path d="M15 10h3l2 3v4h-5z" />
    <circle cx="8" cy="18" r="1.5" />
    <circle cx="17" cy="18" r="1.5" />
  </svg>
)

const canSeePage = (user, permission) => {
  if (user?.isAdmin || user?.role === 'admin') return true
  if (!permission) return true
  return user?.permissions?.includes(permission)
}

export default function Dashboard() {
  const { user } = useAuth()

  const appPages = [
    { title: 'الرئيسية', description: 'لوحة التحكم والملخص العام', to: '/', icon: DashboardIcon, accent: 'blue' },
    { title: 'المتعهدون', description: 'إدارة بيانات المتعهدين', to: '/contractors', icon: PeopleIcon, permission: 'contractors', accent: 'purple' },
    { title: 'أنواع المركبات', description: 'تصنيف أنواع المركبات', to: '/vehicle-types', icon: VehicleTypeIcon, permission: 'vehicleTypes', accent: 'orange' },
    { title: 'السائقون', description: 'عرض وإدارة السائقين', to: '/drivers', icon: DriverIcon, permission: 'drivers', accent: 'green' },
    { title: 'المركبات', description: 'إدارة معلومات المركبات', to: '/vehicles', icon: VehicleIcon, permission: 'vehicles', accent: 'blue' },
    { title: 'مستودعات التحميل', description: 'تعريف مواقع ومستودعات التحميل', to: '/loading-warehouses', icon: WarehouseIcon, permission: 'loadingWarehouses', accent: 'purple' },
    { title: 'وجهات التحميل', description: 'إدارة وجهات التحميل', to: '/loading-destinations', icon: LocationIcon, permission: 'loadingDestinations', accent: 'orange' },
    { title: 'وجهات التفريغ', description: 'إدارة وجهات التفريغ', to: '/unloading-destinations', icon: LocationIcon, permission: 'loadingDestinations', accent: 'green' },
    { title: 'الاستمارات', description: 'عرض الاستمارات وربطها', to: '/forms', icon: FormIcon, permission: 'forms', accent: 'blue' },
    { title: 'تسجيل التفريغ', description: 'إدخال وتسجيل عمليات التفريغ', to: '/unloading-registration', icon: UnloadingIcon, permission: 'forms', accent: 'orange' },
    { title: 'تسجيل التحميل', description: 'إدخال وتسجيل عمليات التحميل', to: '/loading-registration', icon: UnloadingIcon, permission: 'forms', accent: 'green' },
    { title: 'إدارة قوالب المستندات', description: 'تعريف النوع والصورة المرجعية لكل قالب', to: '/document-template-mapper', icon: TemplateIcon, permission: 'forms', accent: 'purple' },
    { title: 'توزيع الرحلات', description: 'تخصيص المركبات على الرحلات', to: '/form-trip-allocator', icon: DispatchIcon, permission: 'forms', accent: 'green' },
    { title: 'سعر نقل التفريغ', description: 'تسعير رحلات التفريغ', to: '/pricing/unloading', icon: PricingIcon, permission: 'forms', accent: 'blue' },
    { title: 'سعر نقل التحميل', description: 'تسعير رحلات التحميل', to: '/pricing/loading', icon: PricingIcon, permission: 'forms', accent: 'purple' },
    { title: 'إضافة البيانات بالصور', description: 'استخراج البيانات من الصور', to: '/add-data-by-image', icon: ImageDataIcon, accent: 'orange' },
  ]

  const visiblePages = appPages.filter((page) => canSeePage(user, page.permission))

  const stats = [
    { icon: '📄', label: 'الصفحات المتاحة', value: String(visiblePages.length), color: 'blue' },
    { icon: '🔐', label: 'نوع الحساب', value: user?.role === 'admin' ? 'مدير' : 'مستخدم', color: 'green' },
    { icon: '🧭', label: 'الوصول السريع', value: 'جاهز', color: 'purple' },
    { icon: '👤', label: 'المستخدم الحالي', value: user?.username || '-', color: 'orange' },
  ]

  return (
    <div className="dashboard-page">
      <div className="welcome-banner">
        <div>
          <h2>مرحباً، {user?.username}! 👋</h2>
          <p>يمكنك الآن الوصول إلى صفحات التطبيق مباشرة من الواجهة الرئيسية عبر الأيقونات التالية.</p>
        </div>
        <span className="welcome-emoji">🏠</span>
      </div>

      <div className="stats-grid">
        {stats.map((item) => (
          <div key={item.label} className="stat-card">
            <div className={`stat-icon ${item.color}`}>{item.icon}</div>
            <div className="stat-info">
              <h3>{item.value}</h3>
              <p>{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="dashboard-shortcuts card">
        <div className="dashboard-section-head">
          <div>
            <h3 className="dashboard-section-title">صفحات التطبيق</h3>
            <p className="dashboard-section-subtitle">اختر الصفحة التي تريد فتحها من خلال أيقونات الوصول السريع.</p>
          </div>
          <span className="dashboard-shortcuts-count">{visiblePages.length} صفحة</span>
        </div>

        <div className="shortcut-grid">
          {visiblePages.map((page) => {
            const Icon = page.icon

            return (
              <Link key={page.to} to={page.to} className={`shortcut-card accent-${page.accent}`}>
                <div className={`shortcut-icon accent-${page.accent}`}>
                  <Icon />
                </div>
                <div className="shortcut-content">
                  <h4>{page.title}</h4>
                  <p>{page.description}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <div className="card">
        <h3 style={{ marginBottom: 8, fontSize: 16, fontWeight: 700 }}>معلومات الحساب</h3>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>
          <strong>اسم المستخدم:</strong> {user?.username}
        </p>
        <p style={{ color: '#64748b', fontSize: 14 }}>
          <strong>الصلاحية:</strong> {user?.role === 'admin' ? '🛡️ مدير النظام' : '👤 مستخدم'}
        </p>
      </div>
    </div>
  )
}
