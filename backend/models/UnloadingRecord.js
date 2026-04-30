const mongoose = require('mongoose');

const unloadingRecordSchema = new mongoose.Schema(
  {
    documentNumber: {
      type: String,
      required: [true, 'رقم المستند مطلوب'],
      trim: true,
    },

    documentNumberKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      select: false,
    },

    documentType: {
      type: String,
      required: [true, 'نوع المستند مطلوب'],
      trim: true,
    },

    productType: {
      type: String,
      default: '',
      trim: true,
    },

    registrationMode: {
      type: String,
      default: 'unloading',
      trim: true,
      enum: ['unloading', 'loading'],
    },

    loadingWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoadingWarehouse',
      required: [true, 'الجهة المجهزة مطلوبة'],
    },

    receiverEntity: {
      type: String,
      required: [true, 'الجهة المرسل إليها مطلوبة'],
      trim: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: [true, 'المركبة مطلوبة'],
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: [true, 'السائق مطلوب'],
    },

    suppliedQuantityLiters: {
      type: Number,
      required: [true, 'الكمية المجهزة مطلوبة'],
      min: [0.001, 'الكمية يجب أن تكون أكبر من صفر'],
    },

    issueDate: {
      type: Date,
      required: [true, 'تاريخ إصدار المستند مطلوب'],
    },

    tripPricing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TripPricing',
      default: null,
    },

    pricingType: {
      type: String,
      default: '',
    },

    priceValue: {
      type: Number,
      default: 0,
    },

    tripAmount: {
      type: Number,
      default: 0,
    },

    advanceAmount: {
      type: Number,
      default: 0,
      min: [0, 'مبلغ السلفة يجب أن يكون صفراً أو أكثر'],
    },

    payableAmount: {
      type: Number,
      default: 0,
    },

    receiptStatus: {
      type: String,
      default: '',
    },

    warnings: {
      type: [String],
      default: [],
    },

    rawText: {
      type: String,
      default: '',
    },

    sourceImagePath: {
      type: String,
      default: '',
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UnloadingRecord', unloadingRecordSchema);
