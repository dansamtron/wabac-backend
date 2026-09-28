/**
 * Buyer (Shopper) Authentication Service
 *
 * Progressive identity: buyers never register and never hold a password.
 * They become identifiable in one of two ways:
 *
 *   1. Magic link  - embedded in the WhatsApp order confirmation we already send.
 *                    One tap, single use, no code to type.
 *   2. One-time code - for a buyer arriving cold on a new device.
 *
 * Verifying a phone number creates (or reuses) the global `Shopper` record and
 * claims every guest order and per-seller `Customer` row carrying that number,
 * so a buyer's first "login" already shows their full purchase history.
 */

const crypto = require('crypto');

const Shopper = require('../../models/Shopper');
const ShopperAuthToken = require('../../models/ShopperAuthToken');
const Customer = require('../../models/Customer');
const Order = require('../../models/Order');
const { generateShopperToken } = require('../../utils/generateToken');
const { normalizePhone, isNigerianPhone, sanitize } = require('../../utils/validators');
const logger = require('../../utils/logger');

const OTP_TTL_MS = 10 * 60 * 1000; // code is valid for 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // one code per phone per minute
const OTP_MAX_ATTEMPTS = 5;
const MAGIC_TTL_MS = 7 * 24 * 60 * 60 * 1000; // tracking links live for a week

const SECRET = process.env.JWT_SECRET || 'wabac_jwt_super_secret_dev_key_2026';

function getWhatsAppService() {
  // Lazy require: whatsappService pulls in the AI stack
  return require('../whatsapp/whatsappService');
}

/**
 * Codes and link tokens are only ever stored hashed.
 */
function hashSecret(value) {
  return crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex');
}

function badRequest(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * When enabled, the generated code is logged and returned by the API so the
 * flow can be exercised without a live WhatsApp Business account. Never enable
 * this in production.
 */
function otpDebugEnabled() {
  return process.env.SHOP_OTP_DEBUG === 'true';
}

function requirePhone(phone) {
  const raw = (phone || '').trim();
  if (!raw) throw badRequest('Phone number is required');

  const clean = normalizePhone(raw) || raw;
  if (!isNigerianPhone(raw) && !/^\+?\d{7,15}$/.test(clean)) {
    throw badRequest('Invalid phone number format');
  }

  return clean;
}

const shopperAuthService = {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  MAGIC_TTL_MS,

  /**
   * Issue a 6 digit code over WhatsApp.
   * Always resolves without revealing whether the number is known.
   */
  async requestOtp({ phone, sellerId = '' }) {
    const cleanPhone = requirePhone(phone);

    // Throttle resends per phone number (the IP limiter sits on the route)
    const recent = await ShopperAuthToken.findOne({
      phone: cleanPhone,
      purpose: 'otp',
      usedAt: null,
      createdAt: { $gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
    }).sort({ createdAt: -1 });

    if (recent) {
      const retryIn = Math.ceil((recent.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now()) / 1000);
      throw badRequest(`A code was just sent. Please wait ${Math.max(retryIn, 1)}s before requesting another.`, 429);
    }

    // Invalidate any outstanding codes for this number
    await ShopperAuthToken.deleteMany({ phone: cleanPhone, purpose: 'otp' });

    const code = String(crypto.randomInt(100000, 1000000));

    await ShopperAuthToken.create({
      phone: cleanPhone,
      purpose: 'otp',
      tokenHash: hashSecret(`${cleanPhone}:${code}`),
      sellerId,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const delivered = await getWhatsAppService().sendSystemNotification({
      to: cleanPhone,
      sellerId,
      body: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`,
    });

    if (!delivered) {
      if (otpDebugEnabled()) {
        logger.warn('Shopper OTP could not be delivered over WhatsApp; debug mode is exposing it:', {
          phone: cleanPhone,
          code,
        });
      } else {
        logger.warn('Shopper OTP could not be delivered over WhatsApp:', { phone: cleanPhone });
      }
    }

    const response = {
      success: true,
      message: 'If that number can receive WhatsApp messages, a verification code is on its way.',
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      delivered,
    };

    if (otpDebugEnabled()) response.devCode = code;
    return response;
  },

  /**
   * Exchange a phone number and code for a buyer session.
   */
  async verifyOtp({ phone, code }) {
    const cleanPhone = requirePhone(phone);
    const cleanCode = String(code || '').trim();

    if (!cleanCode) throw badRequest('Verification code is required');

    const challenge = await ShopperAuthToken.findOne({
      phone: cleanPhone,
      purpose: 'otp',
      usedAt: null,
    }).sort({ createdAt: -1 });

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw badRequest('That code has expired. Please request a new one.', 401);
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw badRequest('Too many incorrect attempts. Please request a new code.', 429);
    }

    if (challenge.tokenHash !== hashSecret(`${cleanPhone}:${cleanCode}`)) {
      challenge.attempts += 1;
      await challenge.save();
      throw badRequest('Incorrect verification code', 401);
    }

    challenge.usedAt = new Date();
    await challenge.save();

    return this.establishSession(cleanPhone);
  },

  /**
   * Mint a single-use magic link token for a phone number.
   * Returned value is the raw token: store it nowhere but the outbound message.
   */
  async createMagicLink({ phone, sellerId = '', orderId = '' }) {
    const cleanPhone = requirePhone(phone);
    const rawToken = crypto.randomBytes(32).toString('hex');

    await ShopperAuthToken.create({
      phone: cleanPhone,
      purpose: 'magic',
      tokenHash: hashSecret(rawToken),
      sellerId,
      orderId,
      expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
    });

    const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
    return {
      token: rawToken,
      url: `${base}/track?t=${rawToken}`,
      expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
    };
  },

  /**
   * Redeem a magic link token for a buyer session. Single use.
   */
  async consumeMagicLink(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) throw badRequest('Link token is required');

    const challenge = await ShopperAuthToken.findOne({
      purpose: 'magic',
      tokenHash: hashSecret(token),
    });

    if (!challenge) throw badRequest('This link is not valid', 401);
    if (challenge.usedAt) throw badRequest('This link has already been used. Request a new code to sign in.', 401);
    if (challenge.expiresAt.getTime() < Date.now()) throw badRequest('This link has expired', 401);

    challenge.usedAt = new Date();
    await challenge.save();

    return this.establishSession(challenge.phone);
  },

  /**
   * Upsert the Shopper, claim historical data, and mint the session token.
   */
  async establishSession(cleanPhone) {
    const now = new Date();

    let shopper = await Shopper.findOne({ phone: cleanPhone });

    if (!shopper) {
      try {
        shopper = await Shopper.create({ phone: cleanPhone, verifiedAt: now, lastLoginAt: now });
      } catch (error) {
        if (error && error.code === 11000) {
          shopper = await Shopper.findOne({ phone: cleanPhone });
        } else {
          throw error;
        }
      }
    } else {
      shopper.verifiedAt = shopper.verifiedAt || now;
      shopper.lastLoginAt = now;
      await shopper.save();
    }

    const claimed = await this.claimHistory(shopper);

    // Adopt the name the buyer already gave at checkout
    if (!shopper.name && claimed.name) {
      shopper.name = claimed.name;
      await shopper.save();
    }

    const token = generateShopperToken({ id: shopper._id.toString(), phone: shopper.phone });

    logger.info('Shopper session established:', {
      shopperId: shopper._id.toString(),
      claimedOrders: claimed.orders,
      claimedCustomerRecords: claimed.customers,
    });

    return { token, shopper: shopper.toJSON(), claimed };
  },

  /**
   * Link every guest order and per-seller customer record with this phone
   * number to the shopper identity.
   */
  async claimHistory(shopper) {
    const shopperId = shopper._id.toString();
    const phone = shopper.phone;

    const [customerRes, orderRes, sample] = await Promise.all([
      Customer.updateMany({ phone, shopperId: null }, { $set: { shopperId } }),
      Order.updateMany({ customerPhone: phone, shopperId: null }, { $set: { shopperId } }),
      Customer.findOne({ phone }).sort({ createdAt: -1 }),
    ]);

    return {
      customers: customerRes.modifiedCount || 0,
      orders: orderRes.modifiedCount || 0,
      name: sample ? sample.name : '',
    };
  },

  /**
   * Update the buyer's own profile fields.
   */
  async updateProfile(shopperId, payload = {}) {
    const updates = {};
    if (payload.name !== undefined) updates.name = sanitize(payload.name, 100);
    if (payload.email !== undefined) updates.email = String(payload.email || '').trim().toLowerCase();

    const shopper = await Shopper.findByIdAndUpdate(shopperId, { $set: updates }, { new: true, runValidators: true });
    if (!shopper) throw badRequest('Shopper not found', 404);

    return shopper.toJSON();
  },
};

module.exports = shopperAuthService;
