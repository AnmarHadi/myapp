const mongoose = require('mongoose');

const distributionSchema = new mongoose.Schema(
  {
    governorate: {
      type: String,
      required: [true, 'المحافظة مطلوبة'],
      trim: true,
    },
    loadingWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoadingWarehouse',
      required: [true, 'مستودع التحميل مطلوب'],
    },
    quantityLiters: {
      type: Number,
      required: [true, 'الكمية المحولة مطلوبة'],
      min: [0.001, 'الكمية يجب أن تكون أكبر من صفر'],
    },
    copyType: {
      type: String,
      required: [true, 'نسخة الاستمارة مطلوبة'],
      enum: ['الأولى', 'الثانية', 'الثالثة', 'طبق الأصل'],
    },
    receiverName: {
      type: String,
      required: [true, 'اسم مستلم الاستمارة مطلوب'],
      trim: true,
    },
  },
  { _id: true }
);

const extensionSchema = new mongoose.Schema(
  {
    adminOrderNumber: {
      type: String,
      required: [true, 'رقم الأمر الإداري مطلوب'],
      trim: true,
    },
    grantedAt: {
      type: Date,
      required: [true, 'تاريخ التمديد مطلوب'],
    },
    allowedUntil: {
      type: Date,
      required: [true, 'تاريخ انتهاء التمديد مطلوب'],
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const formSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: [true, 'رقم الاستمارة مطلوب'],
      trim: true,
    },
    numberKey: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    formDate: {
      type: Date,
      required: [true, 'تاريخ الاستمارة مطلوب'],
    },
    quantityLiters: {
      type: Number,
      required: [true, 'كمية الاستمارة مطلوبة'],
      min: [0.001, 'كمية الاستمارة يجب أن تكون أكبر من صفر'],
    },
    distributions: {
      type: [distributionSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'يجب إضافة توزيع واحد على الأقل',
      },
    },
    extensions: {
      type: [extensionSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Form', formSchema);