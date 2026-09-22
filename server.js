/**
 * HTTP Server Entry Point for WABAC Backend
 */

require('dotenv').config();
const http = require('http');
const app = require('./index');
const { connectDB } = require('./config/db');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = '0.0.0.0';

// Connect to MongoDB
connectDB().catch((err) => {
  logger.error('Database initialization encountered an error:', { error: err.message });
});

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on http://${HOST}:${PORT}`);
  logger.info(`Health check available at http://${HOST}:${PORT}/health`);
});

// Graceful shutdown handling
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  // Force shutdown after 10s if connections remain open
  setTimeout(() => {
    logger.error('Forcefully terminating process after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = server;
