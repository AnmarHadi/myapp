const {
  normalizeDocumentNumber,
  normalizeDateValue,
  canonicalDocumentType,
  canonicalReceiverEntity,
  sanitizeWarehouseName,
  sanitizeDriverName
} = require('./documentVisionNormalizer')

class FieldNormalizer {
  async run({ extracted }) {
    return {
      ...extracted,
      documentNumber: normalizeDocumentNumber(extracted.documentNumber || ''),
      documentType: canonicalDocumentType(extracted.documentType || ''),
      issueDate: normalizeDateValue(extracted.issueDate || ''),
      loadingWarehouseName: sanitizeWarehouseName(extracted.loadingWarehouseName || ''),
      receiverEntity: canonicalReceiverEntity(extracted.receiverEntity || ''),
      driverName: sanitizeDriverName(extracted.driverName || '')
    }
  }
}

module.exports = FieldNormalizer