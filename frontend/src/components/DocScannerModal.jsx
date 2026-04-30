import { useState, useRef, useEffect, useCallback } from 'react'

const HANDLE_R = 14

function loadOpenCV() {
  return new Promise((resolve) => {
    if (window.cv && window.cv.Mat) {
      resolve()
      return
    }

    if (document.getElementById('cv-script')) {
      const wait = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(wait)
          resolve()
        }
      }, 200)
      return
    }

    const script = document.createElement('script')
    script.id = 'cv-script'
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js'
    script.onload = () => {
      const wait = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(wait)
          resolve()
        }
      }, 200)
    }
    document.head.appendChild(script)
  })
}

function orderPoints(pts) {
  const sorted = [...pts].sort((a, b) => a.x - b.x)
  const [l1, l2] = sorted.slice(0, 2).sort((a, b) => a.y - b.y)
  const [r1, r2] = sorted.slice(2).sort((a, b) => a.y - b.y)
  return [l1, r1, r2, l2]
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export default function DocScannerModal({ open, onClose, onConfirm, title, initialFile }) {
  const fileRef = useRef()
  const canvasRef = useRef()
  const imgRef = useRef(null)
  const pendingRef = useRef(null)

  const [status, setStatus] = useState('idle')
  const [corners, setCorners] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [cvLoaded, setCvLoaded] = useState(false)

  useEffect(() => {
    loadOpenCV().then(() => setCvLoaded(true))
  }, [])

  const draw = useCallback((img, crns) => {
    const canvas = canvasRef.current
    if (!canvas || !img) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    if (!crns) return

    const [tl, tr, br, bl] = crns

    ctx.beginPath()
    ctx.moveTo(tl.x, tl.y)
    ctx.lineTo(tr.x, tr.y)
    ctx.lineTo(br.x, br.y)
    ctx.lineTo(bl.x, bl.y)
    ctx.closePath()
    ctx.strokeStyle = '#6366f1'
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.fillStyle = 'rgba(99,102,241,0.08)'
    ctx.fill()

    crns.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2)
      ctx.fillStyle = '#6366f1'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2.5
      ctx.stroke()
    })
  }, [])

  const detectCorners = useCallback((canvasEl, w, h) => {
    if (!window.cv?.Mat) return null
    const cv = window.cv

    try {
      const src = cv.imread(canvasEl)
      const gray = new cv.Mat()
      const blur = new cv.Mat()
      const edge = new cv.Mat()
      const dilate = new cv.Mat()
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U)

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      cv.equalizeHist(gray, gray)
      cv.GaussianBlur(gray, blur, new cv.Size(9, 9), 0)
      cv.Canny(blur, edge, 30, 100)
      cv.dilate(edge, dilate, kernel)

      const contours = new cv.MatVector()
      const hier = new cv.Mat()
      cv.findContours(dilate, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

      const candidates = []

      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        const peri = cv.arcLength(c, true)
        const approx = new cv.Mat()

        for (let eps = 0.01; eps <= 0.06; eps += 0.01) {
          cv.approxPolyDP(c, approx, eps * peri, true)
          if (approx.rows === 4 && area > (w * h * 0.05)) {
            candidates.push({ area, approx: approx.clone() })
            break
          }
        }

        approx.delete()
        c.delete()
      }

      candidates.sort((a, b) => b.area - a.area)

      let result = null
      if (candidates.length > 0) {
        const best = candidates[0].approx
        const pts = []
        for (let i = 0; i < 4; i++) {
          pts.push({ x: best.data32S[i * 2], y: best.data32S[i * 2 + 1] })
        }
        result = orderPoints(pts)
      }

      candidates.forEach((c) => c.approx.delete())
      src.delete()
      gray.delete()
      blur.delete()
      edge.delete()
      dilate.delete()
      kernel.delete()
      contours.delete()
      hier.delete()

      if (result) {
        const valid = result.every(
          (p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h
        )
        if (!valid) return null
      }

      return result
    } catch (e) {
      console.warn('detectCorners error:', e)
      return null
    }
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    if (!canvasRef.current || !imgRef.current || !pendingRef.current) return

    const { w, h } = pendingRef.current
    const canvas = canvasRef.current
    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgRef.current, 0, 0, w, h)

    let crns = cvLoaded ? detectCorners(canvas, w, h) : null

    const fallback = crns || [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]

    pendingRef.current = null
    setCorners(fallback)
    draw(imgRef.current, fallback)
  }, [status, cvLoaded, detectCorners, draw])

  useEffect(() => {
    if (status === 'ready' && corners && imgRef.current) {
      draw(imgRef.current, corners)
    }
  }, [corners, status, draw])

  const loadImage = useCallback((file) => {
    setStatus('loading')
    setCorners(null)

    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const maxW = Math.min(window.innerWidth * 0.82, 700)
      const maxH = Math.min(window.innerHeight * 0.55, 480)
      const s = Math.min(maxW / img.width, maxH / img.height, 1)
      const w = Math.round(img.width * s)
      const h = Math.round(img.height * s)

      imgRef.current = img
      pendingRef.current = { w, h }

      URL.revokeObjectURL(url)
      setStatus('ready')
    }

    img.onerror = () => {
      setStatus('idle')
      URL.revokeObjectURL(url)
    }

    img.src = url
  }, [])

  useEffect(() => {
    if (!open || !initialFile) return
    loadImage(initialFile)
  }, [open, initialFile, loadImage])

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height

    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    }
  }

  const onPointerDown = (e) => {
    if (!corners) return
    const pos = getCanvasPos(e)

    for (let i = 0; i < 4; i++) {
      if (dist(pos, corners[i]) < HANDLE_R * 2) {
        setDragging(i)
        e.preventDefault()
        return
      }
    }
  }

  const onPointerMove = (e) => {
    if (dragging === null || !corners) return
    e.preventDefault()

    const pos = getCanvasPos(e)
    const canvas = canvasRef.current
    const clamped = {
      x: Math.max(0, Math.min(canvas.width, pos.x)),
      y: Math.max(0, Math.min(canvas.height, pos.y)),
    }

    setCorners(corners.map((c, i) => (i === dragging ? clamped : c)))
  }

  const onPointerUp = () => setDragging(null)

  const applyCrop = () => {
    if (!corners || !imgRef.current || !window.cv?.Mat) return

    const cv = window.cv
    const img = imgRef.current

    const rx = img.width / canvasRef.current.width
    const ry = img.height / canvasRef.current.height
    const realPts = corners.map((p) => ({ x: p.x * rx, y: p.y * ry }))
    const [tl, tr, br, bl] = realPts

    const W = Math.round(Math.max(dist(tl, tr), dist(bl, br)))
    const H = Math.round(Math.max(dist(tl, bl), dist(tr, br)))

    const tmp = document.createElement('canvas')
    tmp.width = img.width
    tmp.height = img.height
    tmp.getContext('2d').drawImage(img, 0, 0)

    const src = cv.imread(tmp)
    const dst = new cv.Mat()
    const srcM = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y,
    ])
    const dstM = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      W, 0,
      W, H,
      0, H,
    ])
    const M = cv.getPerspectiveTransform(srcM, dstM)
    cv.warpPerspective(src, dst, M, new cv.Size(W, H))

    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    cv.imshow(out, dst)

    src.delete()
    dst.delete()
    srcM.delete()
    dstM.delete()
    M.delete()

    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      onConfirm({ blob, url })
    }, 'image/jpeg', 0.92)
  }

  const reset = () => {
    setStatus('idle')
    setCorners(null)
    imgRef.current = null
    pendingRef.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  return (
    <div className="vo-overlay" style={{ zIndex: 1100 }} onClick={onClose}>
      <div
        className="vo-modal"
        style={{ maxWidth: 750, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vo-modal-header">
          <h2>📷 {title}</h2>
          <button type="button" className="vo-modal-close" onClick={onClose}>✕</button>
        </div>

        {status === 'idle' && (
          <div className="ds-drop-zone" onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>📂</div>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>اضغط لاختيار صورة</p>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>JPG, PNG — الحد الأقصى 10MB</p>
            {!cvLoaded && (
              <p style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>
                ⏳ جاري تحميل محرك التشذيب...
              </p>
            )}
          </div>
        )}

        {status === 'loading' && (
          <div className="vo-loading" style={{ minHeight: 160 }}>
            <div className="spinner" style={{ borderTopColor: '#6366f1' }} />
            <p>جاري تحليل الصورة...</p>
          </div>
        )}

        {status === 'ready' && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8, textAlign: 'center' }}>
              🔵 اسحب النقاط الزرقاء لضبط حواف الوثيقة
            </p>

            <div style={{ overflow: 'auto', textAlign: 'center' }}>
              <canvas
                ref={canvasRef}
                style={{
                  maxWidth: '100%',
                  cursor: dragging !== null ? 'grabbing' : 'crosshair',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  touchAction: 'none',
                }}
                onMouseDown={onPointerDown}
                onMouseMove={onPointerMove}
                onMouseUp={onPointerUp}
                onMouseLeave={onPointerUp}
                onTouchStart={onPointerDown}
                onTouchMove={onPointerMove}
                onTouchEnd={onPointerUp}
              />
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files[0]
            if (f) loadImage(f)
          }}
        />

        <div className="vo-modal-footer" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn vo-btn-cancel"
            onClick={status === 'ready' ? reset : onClose}
          >
            {status === 'ready' ? '🔄 إعادة الاختيار' : 'إلغاء'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {status === 'idle' && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto', padding: '10px 20px' }}
                onClick={() => fileRef.current?.click()}
              >
                📂 اختر صورة
              </button>
            )}

            {status === 'ready' && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto', padding: '10px 20px' }}
                onClick={applyCrop}
                disabled={!cvLoaded}
              >
                ✂️ {cvLoaded ? 'تشذيب وحفظ' : '⏳ انتظر...'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
