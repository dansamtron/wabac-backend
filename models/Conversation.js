/**
 * Channel Conversation Model
 * Aggregates seller/customer threads independently of the transport adapter.
 */

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    sellerId: {
      type: String,
      required: [true, 'Seller ID is required for tenant isolation'],
      index: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'telegram'],
      default: 'whatsapp',
      required: true,
      index: true,
    },
    // Seller-side account on the transport (WhatsApp business phone / Telegram bot id)
    channelAccountId: { type: String, default: '', trim: true },
    // Customer-side transport identity. For WhatsApp this is the normalized phone.
    channelUserId: { type: String, required: true, trim: true },
    channelUsername: { type: String, default: '', trim: true },
    customerName: { type: String, default: '', trim: true },

    // Legacy/contact fields retained during the reversible Phase C cutover.
    customerPhone: { type: String, default: '', index: true },
    businessPhone: { type: String, default: '' },

    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadCount: { type: Number, default: 0 },
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

conversationSchema.index(
  { sellerId: 1, channel: 1, channelUserId: 1 },
  { unique: true }
);
conversationSchema.index({ sellerId: 1, lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
