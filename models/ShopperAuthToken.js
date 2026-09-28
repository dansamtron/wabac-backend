/**
 * Shopper Authentication Challenge Model
 *
 * Backs both buyer login paths:
 *   - purpose 'otp'   -> 6 digit code sent over WhatsApp
 *   - purpose 'magic' -> single-use signed link embedded in order notifications
 *
 * Only a hash of the secret is ever stored, and documents self-destruct through
 * a TTL index on `expiresAt`.
 */

const mongoose = require('mongoose');

const shopperAuthTokenSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['otp', 'magic'],
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    sellerId: {
      type: String,
      default: '',
    },
    orderId: {
      type: String,
      default: '',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);

// Expire challenges automatically once `expiresAt` passes
shopperAuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ShopperAuthToken = mongoose.model('ShopperAuthToken', shopperAuthTokenSchema);

module.exports = ShopperAuthToken;
