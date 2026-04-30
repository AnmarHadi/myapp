class DocumentAgent {
  constructor(deps) {
    this.templateResolver = deps.templateResolver
    this.imagePreprocessor = deps.imagePreprocessor
    this.templateAligner = deps.templateAligner
    this.fieldExtractor = deps.fieldExtractor
    this.fieldNormalizer = deps.fieldNormalizer
    this.validationEngine = deps.validationEngine
    this.databaseMatcher = deps.databaseMatcher
  }

  async run({ imageBuffer, mimeType, documentKind }) {
    const trace = []
    const startedAt = Date.now()

    const prepared = await this.imagePreprocessor.run({ imageBuffer, mimeType })
    trace.push({ step: 'imagePreprocessor', ok: true })

    const template = await this.templateResolver.resolve({
      documentKind,
      imageMeta: prepared.meta
    })
    trace.push({ step: 'templateResolver', ok: !!template, templateName: template?.name || '' })

    const aligned = await this.templateAligner.run({
      preparedImagePath: prepared.preparedImagePath,
      template
    })
    trace.push({
      step: 'templateAligner',
      ok: !!aligned,
      alignmentScore: aligned?.score || 0
    })

    const extracted = await this.fieldExtractor.run({
      preparedImagePath: prepared.preparedImagePath,
      template,
      aligned
    })
    trace.push({ step: 'fieldExtractor', ok: true })

    const normalized = await this.fieldNormalizer.run({
      extracted,
      template
    })
    trace.push({ step: 'fieldNormalizer', ok: true })

    const validated = await this.validationEngine.run({
      data: normalized,
      template
    })
    trace.push({ step: 'validationEngine', ok: true })

    const matched = await this.databaseMatcher.run({
      data: validated.data
    })
    trace.push({ step: 'databaseMatcher', ok: true })

    return {
      success: true,
      data: matched.data,
      warnings: matched.warnings || [],
      validations: matched.validations || {},
      trace,
      meta: {
        durationMs: Date.now() - startedAt
      }
    }
  }
}

module.exports = DocumentAgent