const path = require('path')
const fs = require('fs/promises')

const TEMPLATE_KIND_MAP = {
  loading: 'loading-template',
  unloading: 'unloading-template',
}

class TemplateResolver {
  async resolve({ documentKind, templateName } = {}) {
    const resolvedName =
      TEMPLATE_KIND_MAP[String(documentKind || '').toLowerCase()] ||
      templateName ||
      'unloading-template'
    const templatePath = path.join(__dirname, '..', 'templates', `${resolvedName}.json`)
    const raw = await fs.readFile(templatePath, 'utf8')
    const json = JSON.parse(raw)

    return {
      name: resolvedName,
      path: templatePath,
      ...json
    }
  }
}

module.exports = TemplateResolver
