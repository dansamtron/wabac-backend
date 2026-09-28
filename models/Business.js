/**
 * Business Profile Mongoose Model
 */

const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
  {
    sellerId: {
      type: String,
      required: true,
      unique: true, // `unique` already builds the index
    },
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: [100, 'Business name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    location: {
      type: String,
      trim: true,
      default: '',
    },
    logo: {
      type: String,
      default: '',
    },
    deliveryInfo: {
      type: String,
      default: 'Lagos 1-2 days, outside Lagos 2-4 days',
    },
    deliveryFee: {
      type: Number,
      default: 1500,
      min: [0, 'Delivery fee cannot be negative'],
    },
    deliveryTime: {
      type: String,
      default: '1-3 days',
    },
    freeDeliveryThreshold: {
      type: Number,
      default: 25000,
      min: [0, 'Free delivery threshold cannot be negative'],
    },
    paymentMethod: {
      type: String,
      enum: ['paystack', 'transfer', 'both'],
      default: 'both',
    },
    paystackEnabled: {
      type: Boolean,
      default: true,
    },
    bankName: {
      type: String,
      default: '',
    },
    accountNumber: {
      type: String,
      default: '',
    },
    accountName: {
      type: String,
      default: '',
    },
    whatsappPhone: {
      type: String,
      default: '',
    },
    whatsappConnected: {
      type: Boolean,
      default: false,
    },
    whatsappVerifiedAt: {
      type: Date,
      default: null,
    },
    // WhatsApp Cloud API credentials (persisted per seller; previously held in memory)
    whatsappPhoneNumberId: {
      type: String,
      default: '',
      trim: true,
    },
    whatsappVerifyToken: {
      type: String,
      default: '',
      trim: true,
    },
    whatsappAccessToken: {
      type: String,
      default: '',
      trim: true,
      select: false, // never returned by default: secret credential
    },
    whatsappWebhookVerified: {
      type: Boolean,
      default: false,
    },

    // Telegram Bot API connection. Secrets are excluded from every normal query
    // and JSON response; server-side adapters explicitly opt in with select().
    telegramBotId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    telegramBotUsername: {
      type: String,
      default: '',
      trim: true,
    },
    telegramBotToken: {
      type: String,
      trim: true,
      select: false,
    },
    telegramWebhookSecret: {
      type: String,
      trim: true,
      select: false,
    },
    telegramWebhookUrl: {
      type: String,
      default: '',
      trim: true,
    },
    telegramConnected: {
      type: Boolean,
      default: false,
    },
    telegramConnectedAt: {
      type: Date,
      default: null,
    },
    telegramWebhookVerified: {
      type: Boolean,
      default: false,
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
        // Never expose channel credentials through an API response
        delete ret.whatsappAccessToken;
        delete ret.telegramBotToken;
        delete ret.telegramWebhookSecret;
        return ret;
      },
    },
  }
);

const Business = mongoose.model('Business', businessSchema);

module.exports = Business;
