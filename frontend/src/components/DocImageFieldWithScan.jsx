import { useState } from 'react'
import DocScannerModal from './DocScannerModal'
import { scanDocumentImage, getScannerErrorMessage, testTwainScanner } from '../utils/scanner'
import ScannerDevicesInfo from './ScannerDevicesInfo'

export default function DocImageFieldWithScan({ label, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [initialFile, setInitialFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [testingTwain, setTestingTwain] = useState(false)
  const [scanError, setScanError] = useState('')
  const [twainMessage, setTwainMessage] = useState('')
  const token = localStorage.getItem('token') || ''

  const handleConfirm = ({ blob, url }) => {
    onChange({ blob, url })
    setOpen(false)
    setInitialFile(null)
  }

  const handleClose = () => {
    setOpen(false)
    setInitialFile(null)
  }

  const handleScan = async () => {
    setScanError('')
    setTwainMessage('')
    setScanning(true)

    try {
      const token = localStorage.getItem('token') || ''
      const { file } = await scanDocumentImage(token, { mode: 'accurate' })
      setInitialFile(file)
      setOpen(true)
    } catch (error) {
      setScanError(getScannerErrorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  const handleTestTwain = async () => {
    setScanError('')
    setTwainMessage('')
    setTestingTwain(true)

    try {
      const result = await testTwainScanner(token)
      setTwainMessage(result.message)
    } catch (error) {
      setScanError(getScannerErrorMessage(error))
    } finally {
      setTestingTwain(false)
    }
  }

  return (
    <div className="form-group">
      <label style={{ fontSize: 13, color: '#475569' }}>
        {label}
        <span style={{ color: '#94a3b8', fontSize: 11, marginRight: 6 }}>(اختياري)</span>
      </label>

      {value ? (
        <div className="ds-preview-wrap">
          <img src={value.url} alt={label} className="ds-preview-img" />
          <div className="ds-preview-actions">
            <button
              type="button"
              className="btn vo-btn-cancel"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => {
                setInitialFile(null)
                setOpen(true)
              }}
            >
              🔄 تغيير
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px', background: '#fee2e2', color: '#dc2626' }}
              onClick={() => onChange(null)}
            >
              🗑️ حذف
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="ds-action-row">
            <button
              type="button"
              className="ds-upload-btn"
              onClick={() => {
                setInitialFile(null)
                setOpen(true)
              }}
            >
              <span style={{ fontSize: 22 }}>📷</span>
              <span>رفع صورة المستند</span>
            </button>

            <button
              type="button"
              className="ds-scan-btn"
              onClick={handleScan}
              disabled={scanning}
            >
              <span style={{ fontSize: 22 }}>🖨️</span>
              <span>{scanning ? 'جاري السحب...' : 'سحب من السكنر'}</span>
            </button>

            <button
              type="button"
              className="ds-scan-btn"
              onClick={handleTestTwain}
              disabled={testingTwain}
            >
              <span style={{ fontSize: 22 }}>🔎</span>
              <span>{testingTwain ? 'جاري الاختبار...' : 'اختبار TWAIN'}</span>
            </button>
          </div>

          <p style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
            عند الضغط على السكنر، سيستخدم التطبيق TWAIN عبر NAPS2 بوضع سريع لالتقاط الصورة من الجهاز المتصل.
          </p>
          <p style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>
            تأكد من وجود الورق داخل الـ feeder، وستظهر نافذة تقدم NAPS2 أثناء السحب.
          </p>

          {scanError && (
            <p style={{ marginTop: 8, color: '#dc2626', fontSize: 12 }}>{scanError}</p>
          )}

          {twainMessage && (
            <p style={{ marginTop: 8, color: '#166534', fontSize: 12 }}>{twainMessage}</p>
          )}

          <ScannerDevicesInfo token={token} />
        </div>
      )}

      <DocScannerModal
        open={open}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={label}
        initialFile={initialFile}
      />
    </div>
  )
}
