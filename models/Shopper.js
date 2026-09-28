/**
 * Shopper (Buyer) Mongoose Model
 *
 * Global, phone-verified buyer identity. Deliberately credential-free:
 * a shopper proves who they are with a WhatsApp magic link or a one-time code,
 * never with a password. One phone number maps to exactly one Shopper, which in
 * turn links to the per-seller `Customer` records created at checkout.
 */

const mongoose = require('mongoose');

const shopperSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true, // `unique` already builds the index
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
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
        return ret;
      },
    },
  }
);

const Shopper = mongoose.model('Shopper', shopperSchema);

module.exports = Shopper;
