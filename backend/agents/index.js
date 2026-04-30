const DocumentAgent = require('./documentAgent')

const TemplateResolver = require('../services/templateResolver')
const ImagePreprocessor = require('../services/imagePreprocessor')
const TemplateAligner = require('../services/templateAligner')
const FieldExtractor = require('../services/fieldExtractor')
const FieldNormalizer = require('../services/fieldNormalizer')
const ValidationEngine = require('../services/validationEngine')
const DatabaseMatcher = require('../services/databaseMatcher')

function buildDocumentAgent() {
  return new DocumentAgent({
    templateResolver: new TemplateResolver(),
    imagePreprocessor: new ImagePreprocessor(),
    templateAligner: new TemplateAligner(),
    fieldExtractor: new FieldExtractor(),
    fieldNormalizer: new FieldNormalizer(),
    validationEngine: new ValidationEngine(),
    databaseMatcher: new DatabaseMatcher()
  })
}

module.exports = {
  buildDocumentAgent
}