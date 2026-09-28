/**
 * Compatibility re-export during the Phase C cutover.
 * Phase D removes the WhatsApp service tree; transcripts now live in the
 * channel-neutral messaging service.
 */

module.exports = require('../messaging/messageService');
