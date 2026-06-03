// services/requestService.js
// Full device request & approval workflow.

const { listPage, getOne, createOne, updateOne, fieldText, selectText } = require('../utils/bitable');
const { TABLES, REQUEST_STATUS, DEVICE_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const audit  = require('./auditService');
const notif  = require('./notificationService');
const invSvc = require('./inventoryService');
const usrSvc = require('./userService');

function toRequest(record) {
  const f = record.fields || {};
  return {
    recordId:            record.record_id,
    requestId:           fieldText(f['Request ID']),
    employeeName:        fieldText(f['Employee Name']),
    employeeId:          fieldText(f['Employee ID']),
    department:          fieldText(f['Department']),
    projectName:         fieldText(f['Project Name']),
    purpose:             fieldText(f['Purpose']),
    durationRequired:    fieldText(f['Duration Required']),
    preferredBrand:      fieldText(f['Preferred Brand']),
    preferredModel:      fieldText(f['Preferred Model']),
    priority:            selectText(f['Priority']),
    requestStatus:       selectText(f['Request Status']),
    tlEmployeeId:        fieldText(f['TL Employee ID']),
    tlDecision:          fieldText(f['TL Decision']),
    tlRemarks:           fieldText(f['TL Remarks']),
    tlDecisionDate:      f['TL Decision Date'] || null,
    assignedInventoryId: fieldText(f['Assigned Inventory ID']),
    remarks:             fieldText(f['Remarks']),
    requestedAt:         f['Requested At'] || null,
  };
}

// ── Submit a new device request ───────────────────────────────────────────────
async function submitRequest(data, actorUser) {
  // Look up TL
  const tl = await usrSvc.getTL(actorUser.employeeId);

  const record = await createOne(TABLES.REQUESTS(), {
    'Employee Name':    actorUser.fullName,
    'Employee ID':      actorUser.employeeId,
    'Department':       data.department    || '',
    'Project Name':     data.projectName   || '',
    'Purpose':          data.purpose       || '',
    'Duration Required':data.durationRequired || '',
    'Preferred Brand':  data.preferredBrand || '',
    'Preferred Model':  data.preferredModel || '',
    'Priority':         { text: data.priority || 'Medium', type: 'text' },
    'Request Status':   { text: REQUEST_STATUS.PENDING, type: 'text' },
    'TL Employee ID':   tl?.employeeId || '',
    'Remarks':          data.remarks || '',
  });

  const req = toRequest(record);

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.REQUEST_CREATED, entityType: 'Request', entityId: record.record_id, newValue: data });

  // Notify employee + TL
  const empUser = await usrSvc.getUserByEmployeeId(actorUser.employeeId);
  await notif.notifyRequestSubmitted({
    employeeName:  actorUser.fullName,
    employeeId:    actorUser.employeeId,
    employeeEmail: empUser?.email || '',
    brand:         data.preferredBrand || 'N/A',
    model:         data.preferredModel || 'N/A',
    tlEmail:       tl?.email || '',
    tlId:          tl?.employeeId || '',
  });

  return req;
}

// ── TL approves a request and assigns a device ────────────────────────────────
async function approveRequest(requestRecordId, { inventoryRecordId, expectedReturnDate, remarks }, actorUser) {
  const reqRecord = await getOne(TABLES.REQUESTS(), requestRecordId);
  if (!reqRecord) throw new Error('Request not found');
  const req = toRequest(reqRecord);

  if (req.requestStatus !== REQUEST_STATUS.PENDING && req.requestStatus !== REQUEST_STATUS.PENDING_CLARIFICATION) {
    throw new Error(`Cannot approve request in status: ${req.requestStatus}`);
  }

  // Verify device is available
  const device = await invSvc.getDevice(inventoryRecordId);
  if (!device) throw new Error('Device not found');
  if (device.deviceStatus === DEVICE_STATUS.ASSIGNED) {
    // Block + notify
    const adminList = await usrSvc.listUsers();
    const admin = adminList.find(u => u.role === 'Admin');
    await notif.notifyReassignmentBlocked({ adminEmail: admin?.email, adminId: admin?.employeeId, imei: device.imei1, assignedTo: device.assignedTo });
    throw new Error(`Device is already assigned to ${device.assignedTo}. It must be returned first.`);
  }
  if (!['New','Available','Returned'].includes(device.deviceStatus)) {
    throw new Error(`Device status is ${device.deviceStatus} — not available for assignment.`);
  }

  const now       = Date.now();
  const returnTs  = expectedReturnDate ? new Date(expectedReturnDate).getTime() : null;

  // 1. Update request
  await updateOne(TABLES.REQUESTS(), requestRecordId, {
    'Request Status':        { text: REQUEST_STATUS.APPROVED, type: 'text' },
    'TL Decision':           'Approved',
    'TL Employee ID':        actorUser.employeeId,
    'TL Remarks':            remarks || '',
    'TL Decision Date':      now,
    'Assigned Inventory ID': inventoryRecordId,
  });

  // 2. Update device
  await invSvc.updateDevice(inventoryRecordId, {
    deviceStatus:       DEVICE_STATUS.ASSIGNED,
    assignedTo:         req.employeeName,
    employeeId:         req.employeeId,
    assignedDate:       now,
    expectedReturnDate: returnTs,
  }, actorUser);

  // 3. Create assignment record
  const { createOne: create } = require('../utils/bitable');
  await create(TABLES.ASSIGNMENTS(), {
    'Inventory Record ID':  inventoryRecordId,
    'IMEI1':               device.imei1,
    'Brand':               device.brand,
    'Device Model':        device.deviceModel,
    'Employee Name':       req.employeeName,
    'Employee ID':         req.employeeId,
    'Request ID':          requestRecordId,
    'Assigned By':         actorUser.employeeId,
    'Assigned Date':       now,
    'Expected Return Date':returnTs,
    'Status':              { text: 'Active', type: 'text' },
    'Remarks':             remarks || '',
  });

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.REQUEST_APPROVED, entityType: 'Request', entityId: requestRecordId, prevValue: { status: req.requestStatus }, newValue: { status: REQUEST_STATUS.APPROVED, device: device.imei1 } });

  // 4. Notify employee
  const empUser = await usrSvc.getUserByEmployeeId(req.employeeId);
  await notif.notifyRequestApproved({
    employeeName:       req.employeeName,
    employeeId:         req.employeeId,
    email:              empUser?.email || '',
    brand:              device.brand,
    model:              device.deviceModel,
    imei:               device.imei1,
    assignedDate:       new Date(now).toLocaleDateString(),
    expectedReturnDate: expectedReturnDate || 'N/A',
  });

  return { success: true, device, request: toRequest(await getOne(TABLES.REQUESTS(), requestRecordId)) };
}

// ── TL rejects a request ──────────────────────────────────────────────────────
async function rejectRequest(requestRecordId, { reason }, actorUser) {
  const reqRecord = await getOne(TABLES.REQUESTS(), requestRecordId);
  if (!reqRecord) throw new Error('Request not found');
  const req = toRequest(reqRecord);

  await updateOne(TABLES.REQUESTS(), requestRecordId, {
    'Request Status': { text: REQUEST_STATUS.REJECTED, type: 'text' },
    'TL Decision':    'Rejected',
    'TL Employee ID': actorUser.employeeId,
    'TL Remarks':     reason || '',
    'TL Decision Date': Date.now(),
  });

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.REQUEST_REJECTED, entityType: 'Request', entityId: requestRecordId, prevValue: { status: req.requestStatus }, newValue: { status: REQUEST_STATUS.REJECTED, reason } });

  // Notify employee
  const empUser = await usrSvc.getUserByEmployeeId(req.employeeId);
  await notif.notifyRequestRejected({
    employeeName: req.employeeName,
    employeeId:   req.employeeId,
    email:        empUser?.email || '',
    brand:        req.preferredBrand,
    model:        req.preferredModel,
    reason:       reason || 'No reason provided',
  });

  return { success: true };
}

// ── TL asks for clarification ─────────────────────────────────────────────────
async function requestClarification(requestRecordId, { message }, actorUser) {
  await updateOne(TABLES.REQUESTS(), requestRecordId, {
    'Request Status': { text: REQUEST_STATUS.PENDING_CLARIFICATION, type: 'text' },
    'TL Remarks':     message || '',
  });
  return { success: true };
}

// ── List requests ─────────────────────────────────────────────────────────────
async function listRequests({ employeeId, status, pageSize = 50, pageToken } = {}) {
  const filters = [];
  if (employeeId) filters.push(`CurrentValue.[Employee ID] = "${employeeId}"`);
  if (status)     filters.push(`CurrentValue.[Request Status] = "${status}"`);
  const filter = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];

  const result = await listPage(TABLES.REQUESTS(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toRequest) };
}

module.exports = { submitRequest, approveRequest, rejectRequest, requestClarification, listRequests };
