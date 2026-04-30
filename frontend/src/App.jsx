import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Setup from './pages/Setup'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contractors from './pages/Contractors'
import LoadingWarehouses from './pages/LoadingWarehouses'
import VehicleTypes from './pages/VehicleTypes'
import Drivers from './pages/Drivers'
import Vehicles from './pages/Vehicles'
import Forms from './pages/Forms'
import AddDataByImage from './pages/AddDataByImage'
import FormTripAllocator from './pages/FormTripAllocator'
import LoadingDestinations from './pages/LoadingDestinations'
import UnloadingRegistration from './pages/UnloadingRegistration'
import LoadingRegistration from './pages/LoadingRegistration'
import TripPricing from './pages/TripPricing'
import DocumentTemplateMapper from './pages/DocumentTemplateMapper'
import UnloadingDestinations from './pages/UnloadingDestinations'
import Products from './pages/Products'

function AppRoutes() {
  const { user, loading, isSetup, backendUnavailable, backendMessage } = useAuth()

  if (loading) {
    return (
      <div className="full-loader">
        <div className="spinner"></div>
      </div>
    )
  }

  if (backendUnavailable) {
    return (
      <div className="full-loader" style={{ padding: '32px', textAlign: 'center', lineHeight: 1.8 }}>
        <div>
          <h2>الخادم يعمل لكن قاعدة البيانات غير متصلة</h2>
          <p>{backendMessage || 'تعذر الاتصال بقاعدة البيانات حالياً.'}</p>
          <p>شغّل MongoDB وسأعيد المحاولة تلقائياً.</p>
        </div>
      </div>
    )
  }

  if (!isSetup) return <Setup />
  if (!user) return <Login />

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />

        <Route path="contractors" element={<Contractors />} />
        <Route path="loading-warehouses" element={<LoadingWarehouses />} />
        <Route path="vehicle-types" element={<VehicleTypes />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="forms" element={<Forms />} />
        <Route path="add-data-by-image" element={<AddDataByImage />} />
        <Route path="form-trip-allocator" element={<FormTripAllocator />} />
        <Route path="loading-destinations" element={<LoadingDestinations />} />
        <Route path="unloading-registration" element={<UnloadingRegistration />} />
        <Route path="loading-registration" element={<LoadingRegistration />} />
        <Route path="document-template-mapper" element={<DocumentTemplateMapper />} />
        <Route path="unloading-destinations" element={<UnloadingDestinations />} />
        <Route path="products" element={<Products />} />

        <Route
          path="pricing/unloading"
          element={<TripPricing mode="unloading" />}
        />

        <Route
          path="pricing/loading"
          element={<TripPricing mode="loading" />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
