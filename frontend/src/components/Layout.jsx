import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

const pageTitles = {
  '/': 'لوحة التحكم',
  '/contractors': 'المتعهدون',
  '/loading-warehouses': 'مستودعات التحميل',
  '/vehicle-types': 'أنواع المركبات',
  '/drivers': 'السائقون',
  '/vehicles': 'المركبات',
  '/forms': 'الاستمارات',
  '/add-data-by-image': 'إضافة البيانات بالصور',
  '/form-trip-allocator': 'توزيع الرحلات',
  '/loading-destinations': 'وجهات التحميل',
  '/unloading-registration': 'تسجيل التفريغ',
  '/loading-registration': 'تسجيل التحميل',
  '/document-template-mapper': 'إدارة قوالب المستندات',
  '/unloading-destinations': 'وجهات التفريغ',
  '/products': 'المنتجات',
  '/pricing/unloading': 'أسعار نقل التفريغ',
  '/pricing/loading': 'أسعار نقل التحميل',
  '/reports': 'التقارير',
  '/documents': 'المستندات',
  '/users': 'المستخدمون',
  '/settings': 'الإعدادات',
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()
  const title = pageTitles[location.pathname] || 'لوحة التحكم'

  return (
    <div className="app-wrapper">
      <Sidebar isOpen={sidebarOpen} />

      <div className="main-wrapper">
        <Navbar
          isOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen((v) => !v)}
          pageTitle={title}
        />
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
