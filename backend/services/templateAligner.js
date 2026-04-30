class TemplateAligner {
  async run({ preparedImagePath, template }) {
    return {
      preparedImagePath,
      templateName: template?.name || '',
      score: 0.5,
      transform: null,
      alignedFields: template?.fields || {}
    }
  }
}

module.exports = TemplateAligner