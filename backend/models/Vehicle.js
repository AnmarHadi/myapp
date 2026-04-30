const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contractor',
      default: null,
    },

    vehicleType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleType',
      default: null,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },

    vehicleNumber: {
      type: String,
      required: [true, 'رقم المركبة مطلوب'],
      trim: true,
    },

    governorate: {
      type: String,
      trim: true,
      default: '',
    },

    capacity: {
      type: Number,
      default: null,
      min: [0, 'حمولة المركبة يجب أن تكون رقماً موجباً'],
      max: [99999, 'حمولة المركبة يجب أن تتكون من خمس مراتب كحد أقصى'],
      validate: {
        validator: (v) => v === null || Number.isInteger(v),
        message: 'حمولة المركبة يجب أن تكون رقماً صحيحاً باللتر',
      },
    },

    annualExpiry: {
      type: Date,
      default: null,
    },

    calibrationExpiry: {
      type: Date,
      default: null,
    },

    annualImage: {
      type: String,
      default: '',
    },

    calibrationImage: {
      type: String,
      default: '',
    },

    vehicleNumberKey: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },

    governorateKey: {
      type: String,
      trim: true,
      default: '',
      select: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

vehicleSchema.index(
  { vehicleNumberKey: 1, governorateKey: 1 },
  { unique: true, name: 'vehicle_number_governorate_unique' }
);

module.exports = mongoose.model('Vehicle', vehicleSchema);