/**
 * Order Processing and Management Service
 * Multi-tenant order lifecycle, frozen price snapshots, stock reservation, and idempotency
 */

const mongoose = require('mongoose');
const Order = require('../../models/Order');
const { getEffectivePrice } = require('../../models/Product');
const customerService = require('../customers/customerService');
const productService = require('../products/productService');
const businessService = require('../sellers/businessService');
const { sanitize, escapeRegex, normalizePhone } = require('../../utils/validators');
const logger = require('../../utils/logger');

function getNotificationService() {
  try {
    return require('../notifications/notificationService');
  } catch {
    return null;
  }
}

function notFound(message = 'Order not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

const orderService = {
  /**
   * Create an order with authoritative price calculation and stock deduction
   */
  async create(sellerId, payload, idempotencyKey) {
    if (!sellerId) {
      const err = new Error('Seller ID is required');
      err.statusCode = 400;
      throw err;
    }

    // Idempotency guard: return cached order if key was already processed
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ sellerId, idempotencyKey });
      if (existingOrder) {
        logger.info('Idempotent order hit:', { idempotencyKey, orderId: existingOrder._id.toString() });
        return existingOrder.toJSON();
      }
    }

    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      const err = new Error('Order must contain at least one item');
      err.statusCode = 400;
      throw err;
    }

    if (!payload.customer || !payload.customer.name || !payload.customer.phone) {
      const err = new Error('Customer name and phone number are required');
      err.statusCode = 400;
      throw err;
    }

    const customerName = sanitize(payload.customer.name, 100);
    const customerPhone = normalizePhone(payload.customer.phone) || payload.customer.phone.trim();
    const customerAddress = sanitize(payload.deliveryAddress || payload.customer.address || '', 300);

    // Upsert customer profile under seller
    const customer = await customerService.upsert(sellerId, {
      name: customerName,
      phone: customerPhone,
      whatsappId: payload.customer.whatsappId || customerPhone,
      address: customerAddress,
      email: payload.customer.email,
      shopperId: payload.shopperId || null,
    });

    // Validate and freeze authoritative prices for each order item
    const validatedItems = [];
    let subtotal = 0;

    for (const item of payload.items) {
      if (!item.productId) {
        const err = new Error('Each order item must specify a productId');
        err.statusCode = 400;
        throw err;
      }

      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        const err = new Error('Item quantity must be a positive integer');
        err.statusCode = 400;
        throw err;
      }

      // Fetch authoritative product from the database
      const product = await productService.getById(item.productId, sellerId);
      if (!product) {
        const err = new Error(`Product not found or does not belong to this seller: ${item.productId}`);
        err.statusCode = 404;
        throw err;
      }

      let variant = null;
      let variantLabel = '';

      if (item.variantId) {
        variant = (product.variants || []).find((v) => v.id === item.variantId);
        if (!variant) {
          const err = new Error(`Variant not found for product: ${product.name}`);
          err.statusCode = 404;
          throw err;
        }
        variantLabel = [variant.size, variant.color, variant.sku].filter(Boolean).join(' / ');
      }

      // Calculate authoritative effective price (never trust frontend or AI pricing!)
      const unitPrice = getEffectivePrice(product, variant);
      const itemSubtotal = unitPrice * qty;
      subtotal += itemSubtotal;

      // Deduct stock from product
      await productService.adjustStock(product.id, sellerId, qty, item.variantId);

      validatedItems.push({
        productId: product.id.toString(),
        variantId: item.variantId || undefined,
        variantLabel: variantLabel || undefined,
        name: product.name,
        price: unitPrice,
        quantity: qty,
        image: (variant && variant.image) || (product.images && product.images[0]) || '',
        subtotal: itemSubtotal,
      });
    }

    // Determine delivery fee using seller's business settings
    let deliveryFee = 0;
    if (payload.deliveryFee !== undefined && !isNaN(Number(payload.deliveryFee))) {
      deliveryFee = Math.max(0, Number(payload.deliveryFee));
    } else {
      const biz = await businessService.getBySellerId(sellerId);
      if (biz && biz.freeDeliveryThreshold && subtotal >= biz.freeDeliveryThreshold) {
        deliveryFee = 0;
      } else {
        deliveryFee = biz && biz.deliveryFee !== undefined ? biz.deliveryFee : 1500;
      }
    }

    const total = subtotal + deliveryFee;

    const order = await Order.create({
      sellerId,
      customerId: customer.id,
      customerName,
      customerPhone,
      customerWhatsappId: customer.whatsappId || customerPhone,
      deliveryAddress: customerAddress,
      items: validatedItems,
      subtotal,
      deliveryFee,
      total,
      paymentStatus: payload.paymentStatus || 'Pending',
      orderStatus: 'Pending',
      paymentReference: payload.paymentReference || '',
      idempotencyKey: idempotencyKey || undefined,
      shopperId: payload.shopperId || null,
    });

    await customerService.incrementOnOrder(customer.id, sellerId, total);
    logger.info('Order created successfully:', { id: order._id.toString(), sellerId, total });

    const orderJson = order.toJSON();
    const ns = getNotificationService();
    if (ns) ns.sendOrderConfirmation(orderJson).catch(() => {});
    return orderJson;
  },

  /**
   * List orders for a seller with status filtering and search
   */
  async list(sellerId, { status, paymentStatus, search } = {}) {
    if (!sellerId) throw new Error('Seller ID is required');

    const filter = { sellerId };
    if (status) filter.orderStatus = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (search) {
      const q = escapeRegex(sanitize(search, 100));
      filter.$or = [
        { customerName: { $regex: q, $options: 'i' } },
        { customerPhone: { $regex: q, $options: 'i' } },
        { 'items.name': { $regex: q, $options: 'i' } },
      ];
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    return orders.map((o) => o.toJSON());
  },

  /**
   * Get single order by ID (tenant isolation enforced)
   */
  async getById(id, sellerId) {
    if (!id || !mongoose.isValidObjectId(id)) throw notFound();

    const query = { _id: id };
    if (sellerId) query.sellerId = sellerId;

    const order = await Order.findOne(query);
    if (!order) throw notFound();

    return order.toJSON();
  },

  /**
   * Update order fulfillment status
   */
  async updateStatus(id, sellerId, orderStatus) {
    const validStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(orderStatus)) {
      const err = new Error(`Invalid order status. Allowed: ${validStatuses.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    if (!id || !mongoose.isValidObjectId(id)) throw notFound();

    const order = await Order.findOneAndUpdate(
      { _id: id, sellerId },
      { $set: { orderStatus } },
      { new: true }
    );
    if (!order) throw notFound();

    logger.info('Order status updated:', { id, orderStatus });
    const orderJson = order.toJSON();
    const ns = getNotificationService();
    if (ns) ns.sendOrderStatusUpdate(orderJson, orderStatus).catch(() => {});
    return orderJson;
  },

  /**
   * Update order payment status and reference
   */
  async updatePaymentStatus(id, sellerId, paymentStatus, paymentReference) {
    const validStatuses = ['Pending', 'Paid', 'Failed', 'Refunded'];
    if (!validStatuses.includes(paymentStatus)) {
      const err = new Error(`Invalid payment status. Allowed: ${validStatuses.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    if (!id || !mongoose.isValidObjectId(id)) throw notFound();

    const updates = { paymentStatus };
    if (paymentReference) updates.paymentReference = paymentReference;

    const query = { _id: id };
    if (sellerId) query.sellerId = sellerId;

    const order = await Order.findOneAndUpdate(query, { $set: updates }, { new: true });
    if (!order) throw notFound();

    return order.toJSON();
  },
};

module.exports = orderService;
