// Audit trail for administrative and security-relevant events. Never pass
// biometric data, passwords or tokens in `details`.
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

function actorFrom(req) {
  if (req?.admin) return { type: 'admin', id: String(req.admin._id), label: req.admin.username };
  if (req?.device) return { type: 'kiosk', id: String(req.device._id), label: req.device.name };
  return { type: req ? 'anonymous' : 'system' };
}

async function record(req, action, { category = 'admin', target, details } = {}) {
  const entry = {
    action,
    category,
    actor: actorFrom(req),
    target,
    details: details ? logger.sanitize(details) : undefined,
    ip: req?.ip,
  };
  logger.info('audit', entry);
  try {
    await AuditLog.create(entry);
  } catch (err) {
    logger.error('Failed to write audit log', { action, err });
  }
}

module.exports = { record };
