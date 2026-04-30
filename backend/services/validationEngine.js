class ValidationEngine {
  async run({ data }) {
    const warnings = []

    if (!data.documentType) warnings.push('نوع المستند غير واضح')
    if (!data.documentNumber) warnings.push('رقم المستند غير واضح')
    if (!data.loadingWarehouseName) warnings.push('الجهة المجهزة/مستودع التحميل غير واضح')
    if (!data.driverName) warnings.push('اسم السائق غير واضح')
    if (!data.issueDate) warnings.push('تاريخ الإصدار غير واضح')

    const validations = {
      documentNumberValid: /^[A-Z]\d{7,8}$/.test(data.documentNumber || ''),
      documentTypeValid: /^(68[ابج]|126 تصدير|126 تصديري|90)$/.test(data.documentType || ''),
      hasWarehouse: !!data.loadingWarehouseName,
      hasDriver: !!data.driverName,
      hasQuantity: Number(data.suppliedQuantityLiters || 0) > 0
    }

    return {
      data,
      warnings,
      validations
    }
  }
}

module.exports = ValidationEngine
