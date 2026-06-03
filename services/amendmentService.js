// services/amendmentService.js
// No direct edits to records — all corrections go through amendment requests.
// Only Admin can approve amendments.

const { listPage, getOne, createOne, updateOne, fieldText, selectText } = require('../utils/bitable');
const { TABLES, AUDIT_ACTIONS } = require('../config/constants');
const audit = require('./auditService');

function toAmendment(record) {
  const f = record.fields || {};
  return {
    recordId:        record.record_id,
    amendmentId:     fieldText(f['Amendment ID']),
    tableName:       fieldText(f['Table Name']),
    recordId_:       fieldText(f['Record ID']),
    fieldName:       fieldText(f['Field Name']),
    originalValue:   fieldText(f['Original Value']),
    requestedValue:  fieldText(f['Requested Value']),
    justification:   fieldText(f['Justification']),
    requestedBy:     fieldText(f['Requested By']),
    requesterId:     fieldText(f['Requester ID']),
    status:          selectText(f['Status']),
    reviewedBy:      fieldText(f['Reviewed By']),
    reviewRemarks:   fieldText(f['Review Remarks']),
    appliedAt:       f['Applied At'] || null,
    createdAt:       f['Created At'] || null,
  };
}

async function requestAmendment({ tableName, recordId, fieldName, requestedValue, justification }, actorUser) {
  // Read current value from the target table
  const targetTableId = process.env[`TABLE_${tableName.toUpperCase()}`] || '';
  let originalValue = '';
  if (targetTableId) {
    const targetRecord = await getOne(targetTableId, recordId);
    originalValue = targetRecord ? fieldText(targetRecord.fields?.[fieldName]) : '';
  }

  const record = await createOne(TABLES.AMENDMENTS(), {
    'Table Name':      tableName,
    'Record ID':       recordId,
    'Field Name':      fieldName,
    'Original Value':  originalValue,
    'Requested Value': requestedValue,
    'Justification':   justification,
    'Requested By':    actorUser.fullName,
    'Requester ID':    actorUser.employeeId,
    'Status':          { text: 'Pending', type: 'text' },
  });

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.AMENDMENT, entityType: 'Amendment', entityId: record.record_id, newValue: { tableName, recordId, fieldName, requestedValue } });

  return toAmendment(record);
}

async function approveAmendment(amendmentRecordId, { remarks }, actorUser) {
  const rec = await getOne(TABLES.AMENDMENTS(), amendmentRecordId);
  if (!rec) throw new Error('Amendment not found');
  const amendment = toAmendment(rec);

  if (amendment.status !== 'Pending') throw new Error(`Amendment already ${amendment.status}`);

  // Apply the change to the target table
  const targetTableId = process.env[`TABLE_${amendment.tableName.toUpperCase()}`] || '';
  if (targetTableId && amendment.recordId_ && amendment.fieldName) {
    await updateOne(targetTableId, amendment.recordId_, {
      [amendment.fieldName]: amendment.requestedValue,
    });
  }

  const now = Date.now();
  await updateOne(TABLES.AMENDMENTS(), amendmentRecordId, {
    'Status':          { text: 'Approved', type: 'text' },
    'Reviewed By':     actorUser.employeeId,
    'Review Remarks':  remarks || '',
    'Applied At':      now,
  });

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.AMENDMENT, entityType: amendment.tableName, entityId: amendment.recordId_, prevValue: amendment.originalValue, newValue: amendment.requestedValue });

  return { success: true };
}

async function rejectAmendment(amendmentRecordId, { remarks }, actorUser) {
  await updateOne(TABLES.AMENDMENTS(), amendmentRecordId, {
    'Status':         { text: 'Rejected', type: 'text' },
    'Reviewed By':    actorUser.employeeId,
    'Review Remarks': remarks || '',
  });
  return { success: true };
}

async function listAmendments({ status, requesterId, pageSize = 50, pageToken } = {}) {
  const filters = [];
  if (status)      filters.push(`CurrentValue.[Status] = "${status}"`);
  if (requesterId) filters.push(`CurrentValue.[Requester ID] = "${requesterId}"`);
  const filter = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];
  const result = await listPage(TABLES.AMENDMENTS(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toAmendment) };
}

module.exports = { requestAmendment, approveAmendment, rejectAmendment, listAmendments };
