/**
 * Health Check Controller
 * Returns platform liveness, uptime, environment, and database connection status
 */

const { isDbConnected } = require('../config/db');

function getHealthStatus(req, res) {
  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: isDbConnected() ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development',
  });
}

module.exports = {
  getHealthStatus,
};
