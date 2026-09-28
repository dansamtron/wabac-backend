/**
 * Order Processing and Checkout Routes
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { optionalShopper } = require('../middleware/shopperMiddleware');

// Order checkout can be performed by authenticated seller or customer checkout (optionalAuth)
router.post('/', optionalAuth, optionalShopper, orderController.createOrder);

// Protected seller order management
router.get('/', protect, orderController.getOrders);
router.get('/:id', protect, orderController.getOrderById);
router.patch('/:id', protect, orderController.updateOrderStatus);
router.patch('/:id/status', protect, orderController.updateOrderStatus);

module.exports = router;
