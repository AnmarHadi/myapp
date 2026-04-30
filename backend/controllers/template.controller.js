const { saveTemplateToFile, readTemplateFromFile, deleteTemplateFromFile, listTemplates } = require('../services/templateStorage')

async function saveTemplate(req, res) {
  try {
    const { templateName, documentKind, documentTypeCode, fields, imageMeta, referenceImage, referenceImageName } = req.body

    console.log('=== CONTROLLER SAVE TEMPLATE ===')
    console.log('templateName:', templateName)
    console.log('field keys:', Object.keys(fields || {}))
    console.log('fields object:', fields)

    if (!templateName || typeof templateName !== 'string') {
      return res.status(400).json({ success: false, message: 'اسم القالب مطلوب' })
    }

    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: 'لا توجد حقول لحفظها' })
    }

    const result = await saveTemplateToFile({
      templateName,
      documentKind,
      documentTypeCode,
      fields,
      imageMeta: imageMeta || {},
      referenceImage,
      referenceImageName,
    })

    return res.json({
      success: true,
      message: 'تم حفظ القالب',
      data: result,
    })
  } catch (error) {
    console.error('saveTemplate error:', error)
    return res.status(500).json({
      success: false,
      message: error.message || 'فشل في حفظ القالب',
    })
  }
}

async function getTemplate(req, res) {
  try {
    const { templateName } = req.params
    const data = await readTemplateFromFile(templateName)

    return res.json({
      success: true,
      data,
    })
  } catch (error) {
    console.error('getTemplate error:', error)
    return res.status(404).json({
      success: false,
      message: error.message || 'القالب غير موجود',
    })
  }
}

async function getTemplates(req, res) {
  try {
    const { documentKind = '' } = req.query || {}
    const data = await listTemplates(documentKind)

    return res.json({
      success: true,
      data,
    })
  } catch (error) {
    console.error('getTemplates error:', error)
    return res.status(500).json({
      success: false,
      message: error.message || 'فشل في جلب القوالب',
    })
  }
}

async function deleteTemplate(req, res) {
  try {
    const { templateName } = req.params

    if (!templateName || typeof templateName !== 'string') {
      return res.status(400).json({ success: false, message: 'اسم القالب مطلوب' })
    }

    const result = await deleteTemplateFromFile(templateName)

    return res.json({
      success: true,
      message: 'تم حذف القالب بنجاح',
      data: result,
    })
  } catch (error) {
    console.error('deleteTemplate error:', error)
    return res.status(404).json({
      success: false,
      message: error.message || 'القالب غير موجود',
    })
  }
}

module.exports = {
  saveTemplate,
  getTemplate,
  getTemplates,
  deleteTemplate,
}
