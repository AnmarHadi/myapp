import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEffect, useState } from 'react'

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <circle cx="12" cy="7" r="3" />
    <path d="M6 21v-1a6 6 0 0 1 12 0v1" />
  </svg>
)

const WarehouseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 4 3 10.5V19h18v-8.5L12 4Z" />
  </svg>
)

const VehicleTypeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <rect x="4" y="6" width="16" height="12" rx="2" />
  </svg>
)

const DriverIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <circle cx="12" cy="8" r="3" />
    <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
  </svg>
)

const VehicleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <rect x="3" y="10" width="18" height="6" rx="2" />
  </svg>
)

const FormIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M7 3h7l5 5v13H7z" />
  </svg>
)

const ImageDataIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <rect x="5" y="4" width="14" height="16" rx="2" />
  </svg>
)

const TemplateIcon = () => <span style={{ fontSize: 18 }}>📑</span>
const PricingIcon = () => <span style={{ fontSize: 18 }}>💰</span>
const LocationIcon = () => <span style={{ fontSize: 18 }}>📍</span>
const UnloadingIcon = () => <span style={{ fontSize: 18 }}>⬇</span>
const LoadingIcon = () => <span style={{ fontSize: 18 }}>⬆</span>
const DispatchIcon = () => <span style={{ fontSize: 18 }}>🚚</span>
const ProductsIcon = () => <span style={{ fontSize: 18 }}>📦</span>

export default function Sidebar({ isOpen }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const isPricingActive = location.pathname.startsWith('/pricing')
  const [openPricing, setOpenPricing] = useState(isPricingActive)

  useEffect(() => {
    if (isPricingActive) {
      setOpenPricing(true)
    }
  }, [isPricingActive])

  const canSee = (permission) => {
    if (user?.isAdmin || user?.role === 'admin') return true
    if (!permission) return true
    return user?.permissions?.includes(permission)
  }

  return (
    <aside className={`sidebar ${isOpen ? '' : 'closed'}`}>
      <div className="sidebar-logo">
        <span className="logo-icon">🚀</span>
        <h2>تطبيقي</h2>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">القائمة الرئيسية</div>

        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">🏠</span>
          <span className="nav-label">الرئيسية</span>
        </NavLink>

        {canSee('contractors') && (
          <NavLink to="/contractors" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><PeopleIcon /></span>
            <span className="nav-label">المتعهدون</span>
          </NavLink>
        )}

        {canSee('vehicleTypes') && (
          <NavLink to="/vehicle-types" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><VehicleTypeIcon /></span>
            <span className="nav-label">أنواع المركبات</span>
          </NavLink>
        )}

        {canSee('drivers') && (
          <NavLink to="/drivers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><DriverIcon /></span>
            <span className="nav-label">السائقون</span>
          </NavLink>
        )}

        {canSee('vehicles') && (
          <NavLink to="/vehicles" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><VehicleIcon /></span>
            <span className="nav-label">المركبات</span>
          </NavLink>
        )}

        {canSee('loadingWarehouses') && (
          <NavLink to="/loading-warehouses" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><WarehouseIcon /></span>
            <span className="nav-label">مستودعات التحميل</span>
          </NavLink>
        )}

        {canSee('loadingDestinations') && (
          <NavLink to="/loading-destinations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><LocationIcon /></span>
            <span className="nav-label">وجهات التحميل</span>
          </NavLink>
        )}

        {canSee('loadingDestinations') && (
          <NavLink to="/unloading-destinations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><LocationIcon /></span>
            <span className="nav-label">وجهات التفريغ</span>
          </NavLink>
        )}

        {canSee('forms') && (
          <NavLink to="/forms" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><FormIcon /></span>
            <span className="nav-label">الاستمارات</span>
          </NavLink>
        )}

        {canSee('forms') && (
          <NavLink to="/unloading-registration" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><UnloadingIcon /></span>
            <span className="nav-label">تسجيل التفريغ</span>
          </NavLink>
        )}

        {canSee('forms') && (
          <NavLink to="/loading-registration" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><LoadingIcon /></span>
            <span className="nav-label">تسجيل التحميل</span>
          </NavLink>
        )}

        {canSee('forms') && (
          <NavLink to="/form-trip-allocator" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><DispatchIcon /></span>
            <span className="nav-label">توزيع الرحلات</span>
          </NavLink>
        )}

        {canSee('forms') && (
          <NavLink to="/document-template-mapper" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon"><TemplateIcon /></span>
            <span className="nav-label">إدارة قوالب المستندات</span>
          </NavLink>
        )}

        <NavLink to="/products" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon"><ProductsIcon /></span>
          <span className="nav-label">المنتجات</span>
        </NavLink>

        {canSee('forms') && (
          <div className={`nav-group ${isPricingActive || openPricing ? 'active' : ''}`}>
            <button
              type="button"
              className="nav-group-toggle"
              onClick={() => setOpenPricing((prev) => !prev)}
            >
              <span className="nav-icon"><PricingIcon /></span>
              <span className="nav-label">أسعار النقلات</span>
              <span className="nav-group-chevron">▾</span>
            </button>

            {openPricing && (
              <div className="nav-submenu">
                <NavLink to="/pricing/unloading" className={({ isActive }) => `nav-item sub ${isActive ? 'active' : ''}`}>
                  <span className="nav-label">تفريغ داخل المعمل</span>
                </NavLink>

                <NavLink to="/pricing/loading" className={({ isActive }) => `nav-item sub ${isActive ? 'active' : ''}`}>
                  <span className="nav-label">تحميل داخل المعمل</span>
                </NavLink>
              </div>
            )}
          </div>
        )}

        <NavLink to="/add-data-by-image" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon"><ImageDataIcon /></span>
          <span className="nav-label">إضافة البيانات بالصور</span>
        </NavLink>

        <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📊</span>
          <span className="nav-label">التقارير</span>
        </NavLink>

        <NavLink to="/documents" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📄</span>
          <span className="nav-label">المستندات</span>
        </NavLink>

        <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">👥</span>
          <span className="nav-label">المستخدمون</span>
        </NavLink>

        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">الإعدادات</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={logout}>
          <span className="nav-icon">🚪</span>
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  )
}
