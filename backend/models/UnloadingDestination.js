const mongoose = require('mongoose');

const unloadingDestinationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم وجهة التفريغ مطلوب'],
      trim: true,
    },

    governorate: {
      type: String,
      required: [true, 'المحافظة مطلوبة'],
      trim: true,
    },

    nameKey: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },

    governorateKey: {
      type: String,
      required: true,
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

unloadingDestinationSchema.index(
  { nameKey: 1, governorateKey: 1 },
  { unique: true, name: 'unloading_destination_name_governorate_unique' }
);

module.exports = mongoose.model('UnloadingDestination', unloadingDestinationSchema);