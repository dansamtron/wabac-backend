/**
 * WhatsApp Message Transcript and Conversation Storage Service
 */

const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');

const messageService = {
  /**
   * Save a message and update conversation thread
   */
  async saveMessage({
    sellerId,
    businessPhone = '',
    customerPhone,
    direction,
    body,
    deterministic = false,
    toolCalls = null,
    status = 'received',
  }) {
    const timestamp = new Date();

    const msg = await Message.create({
      sellerId,
      businessPhone,
      customerPhone,
      direction,
      body,
      timestamp,
      status: direction === 'outbound' ? 'sent' : status,
      deterministic,
      toolCalls,
    });

    // Update or create conversation summary
    await Conversation.findOneAndUpdate(
      { sellerId, customerPhone },
      {
        $set: {
          businessPhone,
          lastMessage: body,
          lastMessageAt: timestamp,
        },
        $inc: { unreadCount: direction === 'inbound' ? 1 : 0 },
      },
      { upsert: true, new: true }
    );

    return msg.toJSON();
  },

  /**
   * List messages for a seller with optional customerPhone and direction filters
   */
  async listMessages(sellerId, { customerPhone, direction } = {}) {
    if (!sellerId) throw new Error('Seller ID is required');

    const filter = { sellerId };
    if (customerPhone) filter.customerPhone = customerPhone;
    if (direction) filter.direction = direction;

    const msgs = await Message.find(filter).sort({ timestamp: 1 });
    return msgs.map((m) => m.toJSON());
  },

  /**
   * Get active conversation threads for a seller
   */
  async getConversations(sellerId) {
    if (!sellerId) throw new Error('Seller ID is required');

    const convs = await Conversation.find({ sellerId }).sort({ lastMessageAt: -1 });
    return convs.map((c) => c.toJSON());
  },
};

module.exports = messageService;
