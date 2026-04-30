const fs = require('fs/promises')
const path = require('path')

const templatesDir = path.join(__dirname, '..', 'templates')
const TEMPLATE_FALLBACKS = {
  'unloading-68a-template': ['unloading-template', 'loading-90-template'],
  'unloading-template': ['loading-90-template'],
}

function safeTemplateName(name = '') {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_')
}

function normalizeDocumentKind(value = '') {
  return String(value || '').trim().toLowerCase()
}

function inferDocumentKindFromTemplateName(templateName = '', documentKind = '') {
  const normalizedKind = normalizeDocumentKind(documentKind)
  if (normalizedKind) return normalizedKind

  const safeName = String(templateName || '').toLowerCase()
  if (safeName.startsWith('loading-')) return 'loading'
  if (safeName.startsWith('unloading-')) return 'unloading'
  return ''
}

async function ensureTemplatesDir() {
  await fs.mkdir(templatesDir, { recursive: true })
}

async function readTemplateObject(templateName, visited = new Set(), debug = false) {
  await ensureTemplatesDir()

  const safeName = safeTemplateName(templateName)
  const filePath = path.join(templatesDir, `${safeName}.json`)

  if (visited.has(safeName)) {
    throw new Error(`Template inheritance cycle detected for ${safeName}`)
  }

  visited.add(safeName)

  if (debug) {
    console.log('--- READ TEMPLATE DEBUG ---')
    console.log('templateName:', templateName)
    console.log('safeName:', safeName)
    console.log('filePath:', filePath)
  }

  let content
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    const fallbacks = TEMPLATE_FALLBACKS[safeName] || []
    for (const fallbackName of fallbacks) {
      try {
        const fallbackData = await readTemplateObject(fallbackName, visited, debug)
        return {
          ...fallbackData,
          templateName: safeName,
        }
      } catch (_fallbackError) {
        // Try next fallback.
      }
    }
    throw error
  }

  if (debug) {
    console.log('read file content:', content)
    console.log('--- END READ TEMPLATE DEBUG ---')
  }

  const data = JSON.parse(content)

  if (data?.extendsTemplateName) {
    const baseTemplate = await readTemplateObject(data.extendsTemplateName, visited, debug)
    return {
      ...baseTemplate,
      ...data,
      templateName: data.templateName || safeName,
      fields: {
        ...(baseTemplate.fields || {}),
        ...(data.fields || {}),
      },
    }
  }

  return data
}

async function saveTemplateToFile({ templateName, documentKind, documentTypeCode, fields, imageMeta, referenceImage, referenceImageName }) {
  await ensureTemplatesDir()

  const safeName = safeTemplateName(templateName)
  const filePath = path.join(templatesDir, `${safeName}.json`)

  const payload = {
    templateName: safeName,
    documentKind: String(documentKind || '').toLowerCase(),
    documentTypeCode: String(documentTypeCode || '').trim(),
    imageMeta: imageMeta || {},
    referenceImage: referenceImage || '',
    referenceImageName: referenceImageName || '',
    fields,
    updatedAt: new Date().toISOString(),
  }

  console.log('--- SAVE TEMPLATE DEBUG ---')
  console.log('templatesDir:', templatesDir)
  console.log('templateName:', templateName)
  console.log('safeName:', safeName)
  console.log('filePath:', filePath)
  console.log('field keys:', Object.keys(fields || {}))
  console.log('fields count:', Object.keys(fields || {}).length)

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')

  const written = await fs.readFile(filePath, 'utf8')
  console.log('written file content:', written)
  console.log('--- END SAVE TEMPLATE DEBUG ---')

  return payload
}

async function readTemplateFromFile(templateName) {
  return readTemplateObject(templateName, new Set(), true)
}

async function deleteTemplateFromFile(templateName) {
  await ensureTemplatesDir()

  const safeName = safeTemplateName(templateName)
  const filePath = path.join(templatesDir, `${safeName}.json`)

  await fs.unlink(filePath)

  return {
    templateName: safeName,
    deleted: true,
  }
}

async function listTemplates(filterDocumentKind = '') {
  await ensureTemplatesDir()

  const files = await fs.readdir(templatesDir)
  const templates = []
  const normalizedFilterKind = normalizeDocumentKind(filterDocumentKind)

  for (const fileName of files) {
    if (!fileName.endsWith('.json')) continue

    const filePath = path.join(templatesDir, fileName)
    try {
      const data = await readTemplateObject(path.basename(fileName, '.json'))
      const documentKind = inferDocumentKindFromTemplateName(
        data.templateName || path.basename(fileName, '.json'),
        data.documentKind || ''
      )
      if (normalizedFilterKind && documentKind !== normalizedFilterKind) continue

      templates.push({
        templateName: data.templateName || path.basename(fileName, '.json'),
        documentKind,
        documentTypeCode: data.documentTypeCode || '',
        hasReferenceImage: Boolean(data.referenceImage || data.referenceImageName),
        referenceImageName: data.referenceImageName || '',
        fieldCount: data?.fields ? Object.keys(data.fields).length : 0,
        updatedAt: data.updatedAt || '',
        imageMeta: data.imageMeta || {},
      })
    } catch (error) {
      console.warn(`[templateStorage] failed to read template ${fileName}:`, error?.message || error)
    }
  }

  templates.sort((a, b) => {
    const aTime = new Date(a.updatedAt || 0).getTime()
    const bTime = new Date(b.updatedAt || 0).getTime()
    return bTime - aTime
  })

  return templates
}

module.exports = {
  saveTemplateToFile,
  readTemplateFromFile,
  deleteTemplateFromFile,
  listTemplates,
}
