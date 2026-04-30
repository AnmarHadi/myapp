const axios = require('axios')

function pickTextFromResponse(data) {
  if (!data) return ''

  if (typeof data === 'string') return data.trim()

  const candidates = [
    data.text,
    data.rawText,
    data.result?.text,
    data.result?.rawText,
    data.result?.fullText,
    data.data?.text,
    data.data?.rawText,
    data.data?.fullText,
    data.ocrText,
    data.extractedText,
    data.output?.text,
    data.output?.rawText,
    data.response?.text,
    data.response?.rawText,
  ]

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  if (Array.isArray(data.lines)) {
    const joined = data.lines
      .map((line) => {
        if (typeof line === 'string') return line
        if (typeof line?.text === 'string') return line.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()

    if (joined) return joined
  }

  if (Array.isArray(data.result?.lines)) {
    const joined = data.result.lines
      .map((line) => {
        if (typeof line === 'string') return line
        if (typeof line?.text === 'string') return line.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()

    if (joined) return joined
  }

  return ''
}

async function readTextFromExternalOcr(buffer, mimeType = 'image/png') {
  const apiUrl = process.env.EXTERNAL_OCR_URL
  const apiKey = process.env.EXTERNAL_OCR_API_KEY

  if (!apiUrl) {
    throw new Error('EXTERNAL_OCR_URL غير معرف في ملف البيئة')
  }

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('الصورة المرسلة إلى OCR غير صالحة')
  }

  const base64Image = buffer.toString('base64')

  try {
    const response = await axios.post(
      apiUrl,
      {
        imageBase64: base64Image,
        mimeType,
        language: 'ar',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    )

    const data = response.data || {}
    const text = pickTextFromResponse(data)

    if (!text) {
      throw new Error('مزود OCR الخارجي لم يرجع نصًا قابلًا للاستخدام')
    }

    return text
  } catch (error) {
    const status = error.response?.status
    const responseData = error.response?.data

    console.error('External OCR error:', {
      message: error.message,
      status,
      responseData,
    })

    throw new Error(
      responseData?.message ||
        responseData?.error ||
        (status ? `فشل OCR الخارجي برمز ${status}` : 'فشل الاتصال بخدمة OCR الخارجية')
    )
  }
}

module.exports = {
  readTextFromExternalOcr,
}