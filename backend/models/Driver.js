const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم السائق مطلوب'],
      trim: true,
    },
    motherName: {
      type: String,
      trim: true,
      default: '',
    },
    birthDate: {
      type: Date,
      default: null,
    },
    nationalId: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: (v) => !v || /^\d{12}$/.test(v),
        message: 'رقم البطاقة الوطنية يجب أن يتكون من 12 رقماً',
      },
    },
    nationalIdExpiry: { type: Date, default: null },
    address: { type: String, trim: true, default: '' },
    licenseType: { type: String, trim: true, default: '' },
    licenseExpiry: { type: Date, default: null },

    // صور البطاقة الوطنية
    nationalIdFront: { type: String, default: '' },
    nationalIdBack: { type: String, default: '' },

    // صور رخصة القيادة
    licenseFront: { type: String, default: '' },
    licenseBack: { type: String, default: '' },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Driver', driverSchema);