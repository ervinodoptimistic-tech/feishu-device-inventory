// services/auditService.js
// Every state-changing action writes an immutable audit log entry.
// NO delete operation is ever exposed — by design.

const { createOne } = require('../utils/bitable');
const { TABLES }    = require('../config/constants');

/**
 * Write an audit log entry.
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.userName
 * @param {string} p.userRole
 * @param {string} p.action      — from AUDIT_ACTIONS
 * @param {string} p.entityType  — e.g. 'Inventory', 'Request', 'Assignment'
 * @param {string} p.entityId
 * @param {any}    p.prevValue
 * @param {any}    p.newValue
 * @param {string} [p.ip]
 */
async function log({ userId, userName, userRole, action, entityType, entityId, prevValue, newValue, ip } = {}) {
  try {
    await createOne(TABLES.AUDIT_LOG(), {
      'User ID':        userId     || 'system',
      'User Name':      userName   || 'system',
      'User Role':      userRole   || '',
      'Action Type':    { text: action, type: 'text' },
      'Entity Type':    entityType || '',
      'Entity ID':      entityId   || '',
      'Previous Value': prevValue !== undefined ? JSON.stringify(prevValue) : '',
      'Updated Value':  newValue  !== undefined ? JSON.stringify(newValue)  : '',
      'IP Address':     ip        || '',
    });
  } catch (err) {
    // Audit failures must never crash the main request
    console.error('[AuditLog] Write failed:', err.message);
  }
}

/**
 * Log a duplicate-block event.
 */
async function logDuplicate({ batchId, fieldName, value, rowData, blockedBy, reason }) {
  try {
    await createOne(TABLES.DUPLICATE_LOG(), {
      'Upload Batch ID':  batchId   || '',
      'Field Name':       fieldName || '',
      'Duplicate Value':  value     || '',
      'Row Data':         typeof rowData === 'object' ? JSON.stringify(rowData) : (rowData || ''),
      'Blocked By':       blockedBy || 'system',
      'Reason':           reason    || 'Duplicate detected',
    });
  } catch (err) {
    console.error('[DuplicateLog] Write failed:', err.message);
  }
}

module.exports = { log, logDuplicate };
