/**
 * AI Tool Access Guards
 *
 * Tools used to receive only the tenant (`sellerId`), which meant any
 * per-customer tool was scoped to "anything in this store" rather than
 * "anything belonging to the person in this conversation". Tools now also
 * receive a context describing the counterparty, and these helpers enforce it.
 */

const { normalizePhone } = require('../../utils/validators');

/**
 * Normalize a context/order phone for comparison.
 * Returns '' for placeholders such as 'anon_customer' so they can never match.
 */
function comparablePhone(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '';

  const normalized = normalizePhone(raw) || raw;
  // Only digit-bearing identifiers count as an identity
  if (!/\d{6,}/.test(normalized)) return '';

  return normalized;
}

/**
 * Build the execution context handed to every tool.
 *
 * @param {Object}  input
 * @param {string}  input.sellerId       tenant the conversation belongs to
 * @param {string}  input.customerPhone  counterparty in the conversation
 * @param {string}  [input.shopperId]    verified buyer identity, when known
 * @param {boolean} [input.trusted]      true only for a seller authenticated
 *                                       against their OWN tenant (dashboard /
 *                                       agent test console), where tenant-wide
 *                                       reads are legitimate
 */
function buildToolContext({ sellerId, customerPhone, shopperId = null, trusted = false }) {
  return {
    sellerId,
    customerPhone: customerPhone || '',
    shopperId,
    trusted: !!trusted,
  };
}

/**
 * True when the order belongs to the counterparty of this conversation.
 */
function ownsOrder(order, context = {}) {
  if (!order) return false;
  if (context.trusted) return true;

  if (context.shopperId && order.shopperId && String(order.shopperId) === String(context.shopperId)) {
    return true;
  }

  const contextPhone = comparablePhone(context.customerPhone);
  const orderPhone = comparablePhone(order.customerPhone);

  return Boolean(contextPhone) && contextPhone === orderPhone;
}

/**
 * Enforce ownership. Deliberately reports "not found" rather than "forbidden"
 * so the agent cannot be used to probe which order IDs exist in a store.
 */
function requireOrderAccess(order, context, orderId) {
  if (!ownsOrder(order, context)) {
    const err = new Error(`Order not found: ${orderId}`);
    err.statusCode = 404;
    throw err;
  }
  return order;
}

module.exports = {
  buildToolContext,
  comparablePhone,
  ownsOrder,
  requireOrderAccess,
};
