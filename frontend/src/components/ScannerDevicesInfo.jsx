import { useEffect, useState } from 'react'
import { checkBackendHealth, fetchScannerDevices, getScannerErrorMessage } from '../utils/scanner'

function formatDeviceLabel(device) {
  const parts = []
  if (device?.displayName) parts.push(device.displayName)
  else if (device?.name) parts.push(device.name)
  if (device?.manufacturer) parts.push(device.manufacturer)
  if (device?.description && device.description !== device.displayName && device.description !== device.name) {
    parts.push(device.description)
  }

  const base = parts.filter(Boolean).join(' - ')
  const typeLabel = device?.driver === 'twain'
    ? 'TWAIN Scanner'
    : device?.driver === 'wia'
      ? 'WIA Scanner'
      : device?.isScanner
        ? 'Scanner'
        : `Type ${device?.type ?? '?'}`
  return base ? `${base} (${typeLabel})` : typeLabel
}

export default function ScannerDevicesInfo({ token }) {
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true

    const load = async () => {
      setLoading(true)
      setError('')

      try {
        const backendReady = await checkBackendHealth()
        if (!backendReady) {
          if (!alive) return
          setError('الخادم الخلفي غير متصل أو لا يستجيب على المنفذ 5000')
          return
        }

        const result = await fetchScannerDevices(token)
        if (!alive) return
        setDevices(result.devices || [])
        if (!result.available) {
          setError(result.detail || result.message || 'لم يتمكن النظام من الوصول إلى TWAIN على هذا الجهاز')
        }
      } catch (err) {
        if (!alive) return
        setError(getScannerErrorMessage(err))
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()

    return () => {
      alive = false
    }
  }, [token])

  const scannerDevices = devices.filter((device) => device?.isScanner)

  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        background: '#f8fafc',
        fontSize: 12,
        color: '#334155',
      }}
    >
      {loading ? (
        <div>جاري فحص أجهزة TWAIN في النظام...</div>
      ) : error ? (
        <div style={{ color: '#b91c1c' }}>{error}</div>
      ) : scannerDevices.length > 0 ? (
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>الأجهزة المكتشفة:</div>
          <ul style={{ margin: 0, paddingRight: 18 }}>
            {scannerDevices.map((device, index) => (
              <li key={device.deviceId || `${device.name || 'scanner'}-${index}`}>
                {formatDeviceLabel(device)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ color: '#b45309' }}>
          لم يتم العثور على أي سكانر TWAIN. إذا كان الجهاز يحتاج تعريف Canon TWAIN فتأكد من تثبيته.
        </div>
      )}
    </div>
  )
}
