const mongoose = require('mongoose');

const tripPricingSchema = new mongoose.Schema(
  {
    operationType: {
      type: String,
      enum: ['loading', 'unloading'],
      required: true,
      trim: true,
    },

    loadingWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoadingWarehouse',
      required: true,
    },

    pricingType: {
      type: String,
      enum: ['liter', 'ton', 'fixed', 'capacityRange'],
      required: true,
    },

    price: {
      type: Number,
      default: 0,
    },

    advance: {
      type: Number,
      default: 0,
    },

    // فقط لنوع الحمولة
    capacityFrom: {
      type: Number,
      default: null,
    },

    capacityTo: {
      type: Number,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

tripPricingSchema.index(
  { operationType: 1, loadingWarehouse: 1, pricingType: 1, capacityFrom: 1, capacityTo: 1 },
  { name: 'trip_pricing_lookup_idx' }
);

module.exports = mongoose.model('TripPricing', tripPricingSchema);