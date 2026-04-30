const mongoose = require('mongoose');

const vehicleTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم نوع المركبة مطلوب'],
      trim: true,
    },
    nameKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      select: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VehicleType', vehicleTypeSchema);
