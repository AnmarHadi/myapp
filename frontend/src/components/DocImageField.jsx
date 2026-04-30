import { useState } from 'react'
import DocScannerModal from './DocScannerModal'

export default function DocImageField({ label, value, onChange }) {
  const [open, setOpen] = useState(false)

  const handleConfirm = ({ blob, url }) => {
    onChange({ blob, url })
    setOpen(false)
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
              type="button" className="btn vo-btn-cancel"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => setOpen(true)}
            >
              🔄 تغيير
            </button>
            <button
              type="button" className="btn"
              style={{ fontSize: 12, padding: '5px 12px', background: '#fee2e2', color: '#dc2626' }}
              onClick={() => onChange(null)}
            >
              🗑️ حذف
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="ds-upload-btn"
          onClick={() => setOpen(true)}
        >
          <span style={{ fontSize: 22 }}>📷</span>
          <span>رفع وتشذيب الصورة</span>
        </button>
      )}

      <DocScannerModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title={label}
      />
    </div>
  )
}