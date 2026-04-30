const mongoose = require('mongoose');

const contractorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المتعهد مطلوب'],
      unique: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Contractor', contractorSchema);