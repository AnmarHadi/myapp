const { runEasyOcr } = require('./unloadingEasyOcrBridge')

class FieldExtractor {
  async run({ preparedImagePath, template }) {
    const result = await runEasyOcr(preparedImagePath, template?.name || 'unloading-template')
    return result
  }
}

module.exports = FieldExtractor