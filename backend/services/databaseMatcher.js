const LoadingWarehouse = require('../models/LoadingWarehouse')
const Vehicle = require('../models/Vehicle')
const Driver = require('../models/Driver')

function escapeRegex(v = '') {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class DatabaseMatcher {
  async run({ data }) {
    const warnings = []
    const validations = {}

    let loadingWarehouse = null
    if (data.loadingWarehouseName) {
      loadingWarehouse = await LoadingWarehouse.findOne({
        name: { $regex: escapeRegex(data.loadingWarehouseName), $options: 'i' }
      })
    }

    let vehicle = null
    if (data.vehicleNumber || data.vehicleNumberRaw) {
      const seed = data.vehicleNumber || data.vehicleNumberRaw
      vehicle = await Vehicle.findOne({
        vehicleNumber: { $regex: escapeRegex(seed), $options: 'i' }
      }).populate('driver owner vehicleType')
    }

    let driver = null
    if (data.driverName) {
      driver = await Driver.findOne({
        name: { $regex: escapeRegex(data.driverName), $options: 'i' }
      })
    }

    validations.loadingWarehouseFound = !!loadingWarehouse
    validations.vehicleFound = !!vehicle
    validations.driverFound = !!driver

    if (!loadingWarehouse) warnings.push('لم يتم العثور على مستودع التحميل في قاعدة البيانات')
    if (!vehicle) warnings.push('لم يتم العثور على المركبة في قاعدة البيانات')
    if (!driver) warnings.push('لم يتم العثور على السائق في قاعدة البيانات')

    return {
      data: {
        ...data,
        loadingWarehouseId: loadingWarehouse?._id || null,
        vehicleId: vehicle?._id || null,
        driverId: driver?._id || null
      },
      warnings,
      validations
    }
  }
}

module.exports = DatabaseMatcher