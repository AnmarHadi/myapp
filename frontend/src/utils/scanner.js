import axios from 'axios'

const BACKEND_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const SCANNER_API_BASE = `${BACKEND_BASE}/api`

function toAbsoluteBackendUrl(url = '') {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${BACKEND_BASE}${url.startsWith('/') ? '' : '/'}${url}`
}

export async function scanDocumentImage(token, options = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const payload = options?.mode ? { mode: options.mode } : {}
  const { data } = await axios.post(`${SCANNER_API_BASE}/scanner/scan`, payload, {
    headers,
    timeout: 180000,
  })

  const imageUrl = toAbsoluteBackendUrl(data?.publicUrl || data?.url || '')
  if (!imageUrl) {
    throw new Error('لم يعُد السكانر صورة صالحة')
  }

  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error('تعذر تحميل الصورة الملتقطة من السكانر')
  }

  const blob = await response.blob()
  const fileName = data?.fileName || `scan-${Date.now()}.jpg`
  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })

  return {
    file,
    imageUrl,
  }
}

export async function fetchScannerDevices(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const { data } = await axios.get(`${SCANNER_API_BASE}/scanner/devices`, { headers, timeout: 30000 })
  return {
    available: Boolean(data?.available),
    devices: Array.isArray(data?.devices) ? data.devices : [],
    scannerCount: Number(data?.scannerCount || 0),
    message: data?.message || '',
    detail: data?.detail || '',
  }
}

export async function testTwainScanner(token) {
  const result = await fetchScannerDevices(token)
  const allDevices = Array.isArray(result.devices) ? result.devices : []
  const twainDevices = allDevices.filter((device) => {
    const label = `${device?.driver || ''} ${device?.displayName || device?.name || ''}`
    return /twain/i.test(label) || /canon/i.test(label)
  })
  const canonDevice = allDevices.find((device) => /Canon\s+DR-M160/i.test(device.displayName || device.name || ''))
  const selected = canonDevice || twainDevices[0] || allDevices[0] || null

  if (!selected) {
    throw new Error(
      result.detail ||
        result.message ||
        'لم يتم العثور على أي سكانر TWAIN. أعد تشغيل backend ثم جرّب مرة أخرى.'
    )
  }

  return {
    ok: true,
    device: selected,
    scannerCount: result.scannerCount,
    message: `تم العثور على TWAIN بنجاح: ${selected.displayName || selected.name}`,
  }
}

export async function checkBackendHealth() {
  const { data } = await axios.get(`${SCANNER_API_BASE}/health`, { timeout: 8000 })
  return Boolean(data?.success || data?.status === 'ok')
}

export function getScannerErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.detail ||
    error?.message ||
    'تعذر سحب الصورة من السكنر'
  )
}
