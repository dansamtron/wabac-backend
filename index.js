/**
 * WABAC (WhatsApp Business AI Commerce) Backend Application
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
const { isDbConnected } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// Route imports
const authRoutes = require('./routes/authRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const customerRoutes = require('./routes/customerRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const platformRoutes = require('./routes/platformRoutes');

const app = express();

// CORS configuration
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server, webhooks)
      if (!origin) return callback(null, true);

      // Allow any localhost, 127.0.0.1, or e2b preview domains
      if (
        allowedOrigins.includes(origin) ||
        /^http:\/\/localhost:\d+$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
        /\.e2b\.app$/.test(origin)
      ) {
        return callback(null, true);
      }

      callback(null, true); // Dev-friendly fallback
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Idempotency-Key',
      'X-Hub-Signature-256',
      'X-Paystack-Signature',
      'X-Requested-With',
    ],
  })
);

// Body parsers with 500KB limit matching frontend specifications
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));
app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Root / Welcome route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    name: 'WABAC API',
    description: 'WhatsApp Business AI Commerce Backend Platform',
    version: '1.0.0',
    documentation: '/api',
  });
});

// Health check endpoints
const healthHandler = (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: isDbConnected() ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development',
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// API Documentation / Info
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'WABAC REST API is active',
    endpoints: {
      auth: '/api/auth',
      sellers: '/api/sellers',
      business: '/api/business',
      products: '/api/products',
      orders: '/api/orders',
      customers: '/api/customers',
      whatsapp: '/api/whatsapp',
      payments: '/api/payments',
      admin: '/api/admin',
      platform: '/api/platform',
    },
  });
});

// Mount modular routes
app.use('/api/auth', authRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/business', sellerRoutes); // Direct mount for businessService compatibility
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', platformRoutes);
app.use('/api/platform', platformRoutes);

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

module.exports = app;
