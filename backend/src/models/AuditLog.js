const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    category: { type: String, enum: ['admin', 'auth', 'security', 'system'], default: 'admin' },
    actor: {
      type: { type: String, enum: ['admin', 'kiosk', 'system', 'anonymous'], default: 'system' },
      id: String,
      label: String,
    },
    target: { type: { type: String }, id: String, label: String },
    details: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
