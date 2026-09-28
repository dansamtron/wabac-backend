/**
 * WhatsApp Business Cloud API Integration Service
 * Manages seller WhatsApp onboarding, outbound messaging, webhook processing, and message threads
 *
 * Connection credentials are persisted on the seller's Business document -
 * there is no in-memory credential cache.
 */

const businessService = require('../sellers/businessService');
const customerService = require('../customers/customerService');
const webhookService = require('./webhookService');
const messageService = require('./messageService');
const aiService = require('../ai/aiService');
const Business = require('../../models/Business');
const { sanitize, normalizePhone } = require('../../utils/validators');
const logger = require('../../utils/logger');

/**
 * Low level Meta Graph delivery. Returns true when WhatsApp accepted the message.
 * Never throws: callers decide how a delivery failure should surface.
 */
async function deliverViaGraph({ to, body, phoneNumberId, accessToken }) {
  if (!phoneNumberId || !accessToken) return false;

  try {
    const apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
    const url = `${apiUrl}/${apiVersion}/${phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: String(to).replace('+', ''),
        type: 'text',
        text: { preview_url: false, body },
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      logger.warn('Meta WhatsApp API call failed:', errData);
      return false;
    }

    return true;
  } catch (err) {
    logger.error('WhatsApp API network error:', { error: err.message });
    return false;
  }
}

const whatsappService = {
  /**
   * Get WhatsApp configuration for seller
   */
  async getConfig(sellerId) {
    if (!sellerId) throw new Error('Seller ID is required');

    const business = await businessService.requireBySellerId(sellerId);
    const secrets = await businessService.getWithSecrets(sellerId);
    const accessToken = (secrets && secrets.whatsappAccessToken) || process.env.WHATSAPP_ACCESS_TOKEN || '';

    return {
      sellerId,
      businessPhone: business.whatsappPhone || '',
      phoneNumberId: business.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: business.whatsappVerifyToken || process.env.WHATSAPP_VERIFY_TOKEN || '',
      accessToken: accessToken ? '***configured***' : '',
      webhookUrl: `${process.env.CLIENT_URL || 'http://localhost:5000'}/api/whatsapp/webhook`,
      webhookVerified: !!business.whatsappWebhookVerified,
      connectedAt: business.whatsappVerifiedAt || null,
      whatsappConnected: !!business.whatsappConnected,
    };
  },

  /**
   * Connect seller WhatsApp Business Account
   */
  async connect(sellerId, payload = {}) {
    if (!sellerId) throw new Error('Seller ID is required');

    const rawPhone = payload.businessPhone || payload.phone;
    if (!rawPhone) {
      const err = new Error('Business phone number is required');
      err.statusCode = 400;
      throw err;
    }

    const cleanPhone = normalizePhone(rawPhone) || String(rawPhone).trim();
    const now = new Date();

    const updates = {
      whatsappPhone: cleanPhone,
      whatsappConnected: true,
      whatsappVerifiedAt: now,
      whatsappWebhookVerified: true,
    };

    if (payload.phoneNumberId !== undefined) updates.whatsappPhoneNumberId = String(payload.phoneNumberId).trim();
    if (payload.verifyToken !== undefined) updates.whatsappVerifyToken = String(payload.verifyToken).trim();
    if (payload.accessToken !== undefined) updates.whatsappAccessToken = String(payload.accessToken).trim();

    await businessService.update(sellerId, updates);

    logger.info('WhatsApp connected for seller:', { sellerId, businessPhone: cleanPhone });
    return this.getConfig(sellerId);
  },

  /**
   * Disconnect seller WhatsApp Business Account
   */
  async disconnect(sellerId) {
    if (!sellerId) throw new Error('Seller ID is required');

    await businessService.update(sellerId, {
      whatsappConnected: false,
      whatsappVerifiedAt: null,
      whatsappWebhookVerified: false,
      whatsappPhoneNumberId: '',
      whatsappVerifyToken: '',
      whatsappAccessToken: '',
    });

    logger.info('WhatsApp disconnected for seller:', { sellerId });
    return { success: true, message: 'WhatsApp disconnected' };
  },

  /**
   * Send outbound message via WhatsApp Cloud API
   */
  async sendOutbound({ sellerId, to, body, businessPhone = '' }) {
    if (!sellerId) {
      const err = new Error('Seller ID is required');
      err.statusCode = 400;
      throw err;
    }

    if (!to || !body) {
      const err = new Error('Recipient number ("to") and message "body" are required');
      err.statusCode = 400;
      throw err;
    }

    const cleanTo = normalizePhone(to) || to.trim();
    const cleanBody = sanitize(body, 4000);

    const business = await businessService.getWithSecrets(sellerId);
    const phoneNumberId = (business && business.whatsappPhoneNumberId) || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = (business && business.whatsappAccessToken) || process.env.WHATSAPP_ACCESS_TOKEN;

    // If live credentials exist, send via Meta Graph API
    await deliverViaGraph({ to: cleanTo, body: cleanBody, phoneNumberId, accessToken });

    // Record outbound message in transcript
    return messageService.saveMessage({
      sellerId,
      businessPhone: businessPhone || (business && business.whatsappPhone) || '',
      customerPhone: cleanTo,
      direction: 'outbound',
      body: cleanBody,
      deterministic: false,
      status: 'sent',
    });
  },

  /**
   * Deliver a platform system message (login codes, magic links) to a phone number.
   *
   * Unlike sendOutbound this is intentionally NOT persisted to the seller's
   * conversation transcript: authentication traffic is not merchant CRM data.
   * Falls back to the platform's own WhatsApp number when the seller has none.
   *
   * @returns {Promise<boolean>} true when WhatsApp accepted the message
   */
  async sendSystemNotification({ to, body, sellerId = '' }) {
    if (!to || !body) return false;

    const cleanTo = normalizePhone(to) || String(to).trim();
    const cleanBody = sanitize(body, 1000);

    let phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    let accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (sellerId) {
      const business = await businessService.getWithSecrets(sellerId);
      if (business && business.whatsappPhoneNumberId && business.whatsappAccessToken) {
        phoneNumberId = business.whatsappPhoneNumberId;
        accessToken = business.whatsappAccessToken;
      }
    }

    return deliverViaGraph({ to: cleanTo, body: cleanBody, phoneNumberId, accessToken });
  },

  /**
   * Process incoming customer WhatsApp message
   */
  async handleIncoming(payload) {
    const parsed = webhookService.parseIncomingPayload(payload);
    if (!parsed) {
      const err = new Error('Invalid incoming WhatsApp message format');
      err.statusCode = 400;
      throw err;
    }

    const customerPhone = normalizePhone(parsed.from) || parsed.from.trim();
    const body = sanitize(parsed.body, 4000);
    const businessPhone = parsed.businessPhone ? normalizePhone(parsed.businessPhone) : '';

    // Identify the target seller by business phone
    let sellerId = payload.sellerId;

    if (!sellerId && businessPhone) {
      const biz = await Business.findOne({ whatsappPhone: businessPhone });
      if (biz) sellerId = biz.sellerId;
    }

    // No silent fallback seller: an unroutable message is an error, not someone else's conversation
    if (!sellerId) {
      const err = new Error(
        `Unable to route inbound WhatsApp message: no seller is connected to business phone "${businessPhone || 'unknown'}"`
      );
      err.statusCode = 404;
      throw err;
    }

    // 1. Record inbound message
    const inbound = await messageService.saveMessage({
      sellerId,
      businessPhone,
      customerPhone,
      direction: 'inbound',
      body,
      status: 'received',
    });

    // 2. Generate authoritative reply (AI agent with fallback to deterministic engine)
    let replyText = '';
    let toolCalls = null;
    let isDeterministic = false;

    const cleanLower = body.trim().toLowerCase();
    if (['stop', 'unsubscribe', 'optout', 'opt-out', 'cancel'].includes(cleanLower)) {
      await customerService.setOptOut(customerPhone, sellerId, true);
      const biz = await businessService.getBySellerId(sellerId);
      const store = (biz && biz.name) || 'Our Store';
      replyText = `You have been successfully unsubscribed from marketing messages from ${store}. You will still receive essential order updates. Text START anytime to re-subscribe.`;
      isDeterministic = true;
    } else if (['start', 'subscribe', 'unstop'].includes(cleanLower)) {
      await customerService.setOptOut(customerPhone, sellerId, false);
      const biz = await businessService.getBySellerId(sellerId);
      const store = (biz && biz.name) || 'Our Store';
      replyText = `Welcome back! You have been re-subscribed to marketing updates from ${store}.`;
      isDeterministic = true;
    } else {
      try {
        const aiRes = await aiService.chat({
          sellerId,
          customerPhone,
          body,
        });
        replyText = aiRes.reply;
        toolCalls = aiRes.toolCalls;
      } catch (err) {
        logger.warn('AI agent failed, using deterministic reply engine:', { error: err.message });
        replyText = await webhookService.deterministicReply(sellerId, body);
        isDeterministic = true;
      }
    }

    // 3. Record outbound response
    const outbound = await messageService.saveMessage({
      sellerId,
      businessPhone,
      customerPhone,
      direction: 'outbound',
      body: replyText,
      deterministic: isDeterministic,
      toolCalls,
      status: 'sent',
    });

    logger.info('WhatsApp conversation exchange processed:', {
      sellerId,
      customerPhone,
      inboundLength: body.length,
      replyLength: replyText.length,
    });

    return {
      inbound,
      outbound,
      toolCalls,
    };
  },

  listMessages(sellerId, filters) {
    return messageService.listMessages(sellerId, filters);
  },

  getConversations(sellerId) {
    return messageService.getConversations(sellerId);
  },
};

module.exports = whatsappService;
