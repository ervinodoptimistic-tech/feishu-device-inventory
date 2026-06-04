// services/requestService.js  v2
// Device request & approval workflow.
// Approval can be done by TL OR InventoryHolder.

const { listPage, getOne, createOne, updateOne, fieldText, selectText } = require('../utils/bitable');
const { TABLES, REQUEST_STATUS, DEVICE_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const audit  = require('./auditService');
const notif  = require('./notificationService');
const bot    = require('./feishuBotService');   // Feishu chat messages
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

// ── Submit request ────────────────────────────────────────────────────────────
async function submitRequest(data, actorUser) {
  // Find inventory holders to notify
  const allUsers = await usrSvc.listUsers();
  const holders  = allUsers.filter(u => u.role === 'InventoryHolder' || u.role === 'Admin');
  const holder   = holders[0]; // primary holder

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
    'TL Employee ID':   holder?.employeeId || '',
    'Remarks':          data.remarks || '',
  });

  const req = toRequest(record);

  await audit.log({
    ...actorUser, action: AUDIT_ACTIONS.REQUEST_CREATED,
    entityType: 'Request', entityId: record.record_id, newValue: data,
  });

  // Email + Feishu chat: notify employee + all inventory holders
  const empUser = await usrSvc.getUserByEmployeeId(actorUser.employeeId);
  await notif.notifyRequestSubmitted({
    employeeName:  actorUser.fullName,
    employeeId:    actorUser.employeeId,
    employeeEmail: empUser?.email || '',
    brand:         data.preferredBrand || 'Any',
    model:         data.preferredModel || '',
    holderName:    holder?.fullName    || 'Inventory Team',
    holderEmail:   holder?.email       || '',
    holderId:      holder?.employeeId  || '',
  });

  // Send Feishu chat notification to ALL inventory holders
  for (const h of holders) {
    if (h.email) {
      bot.notifyHolderNewRequest({
        holderEmail:     h.email,
        requesterName:   actorUser.fullName,
        requesterId:     actorUser.employeeId,
        brand:           data.preferredBrand || 'Any',
        model:           data.preferredModel || '',
        purpose:         data.purpose        || '',
        priority:        data.priority       || 'Medium',
        requestRecordId: record.record_id,
      }).catch(e => console.error('[Bot] notifyHolderNewRequest:', e.message));
    }
  }

  return req;
}

// ── Approve request ───────────────────────────────────────────────────────────
async function approveRequest(requestRecordId, { inventoryRecordId, expectedReturnDate, remarks }, actorUser) {
  const reqRecord = await getOne(TABLES.REQUESTS(), requestRecordId);
  if (!reqRecord) throw new Error('Request not found');
  const reqData = toRequest(reqRecord);

  if (reqData.requestStatus !== REQUEST_STATUS.PENDING &&
      reqData.requestStatus !== REQUEST_STATUS.PENDING_CLARIFICATION) {
    throw new Error(`Cannot approve — request status is: ${reqData.requestStatus}`);
  }

  // Verify device available
  const device = await invSvc.getDevice(inventoryRecordId);
  if (!device) throw new Error('Device not found');
  if (device.deviceStatus === DEVICE_STATUS.ASSIGNED) {
    const adminList = await usrSvc.listUsers();
    const admin = adminList.find(u => u.role === 'Admin');
    await notif.notifyReassignmentBlocked({ adminEmail: admin?.email, adminId: admin?.employeeId, imei: device.imei1, assignedTo: device.assignedTo });
    throw new Error(`Device is already assigned to ${device.assignedTo}. Must be returned first.`);
  }
  if (!['New','Available','Returned'].includes(device.deviceStatus)) {
    throw new Error(`Device status is "${device.deviceStatus}" — not available for assignment.`);
  }

  const now      = Date.now();
  const returnTs = expectedReturnDate ? new Date(expectedReturnDate).getTime() : null;

  // Update request
  await updateOne(TABLES.REQUESTS(), requestRecordId, {
    'Request Status':        { text: REQUEST_STATUS.APPROVED, type: 'text' },
    'TL Decision':           'Approved',
    'TL Employee ID':        actorUser.employeeId,
    'TL Remarks':            remarks || '',
    'TL Decision Date':      now,
    'Assigned Inventory ID': inventoryRecordId,
  });

  // Update device
  await invSvc.updateDevice(inventoryRecordId, {
    deviceStatus:       DEVICE_STATUS.ASSIGNED,
    assignedTo:         reqData.employeeName,
    employeeId:         reqData.employeeId,
    assignedDate:       now,
    expectedReturnDate: returnTs,
  }, actorUser);

  // Create assignment record
  await createOne(TABLES.ASSIGNMENTS(), {
    'Inventory Record ID':   inventoryRecordId,
    'IMEI1':                 device.imei1,
    'Brand':                 device.brand,
    'Device Model':          device.deviceModel,
    'Employee Name':         reqData.employeeName,
    'Employee ID':           reqData.employeeId,
    'Request ID':            requestRecordId,
    'Assigned By':           actorUser.employeeId,
    'Assigned Date':         now,
    'Expected Return Date':  returnTs,
    'Status':                { text: 'Active', type: 'text' },
    'Remarks':               remarks || '',
  });

  await audit.log({
    ...actorUser, action: AUDIT_ACTIONS.REQUEST_APPROVED,
    entityType: 'Request', entityId: requestRecordId,
    prevValue: { status: reqData.requestStatus },
    newValue: { status: REQUEST_STATUS.APPROVED, imei: device.imei1 },
  });

  // Email employee — device assigned notification
  const empUser = await usrSvc.getUserByEmployeeId(reqData.employeeId);
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : 'N/A';

  await notif.notifyRequestApproved({
    employeeName:       reqData.employeeName,
    employeeId:         reqData.employeeId,
    email:              empUser?.email || '',
    brand:              device.brand,
    model:              device.deviceModel,
    imei:               device.imei1,
    serialNumber:       device.serialNumber || '',
    assignedDate:       fmtDate(now),
    expectedReturnDate: fmtDate(returnTs),
    holderName:         actorUser.fullName,
  });

  // Feishu chat notification to employee
  if (empUser?.email) {
    bot.notifyRequesterApproved({
      email:        empUser.email,
      requesterName:reqData.employeeName,
      brand:        device.brand,
      model:        device.deviceModel,
      imei:         device.imei1,
      serialNumber: device.serialNumber || '',
      assignedDate: fmtDate(now),
      returnDate:   fmtDate(returnTs),
      holderName:   actorUser.fullName,
    }).catch(e => console.error('[Bot] notifyRequesterApproved:', e.message));
  }

  return {
    success: true,
    device,
    request: toRequest(await getOne(TABLES.REQUESTS(), requestRecordId)),
  };
}

// ── Reject request ────────────────────────────────────────────────────────────
async function rejectRequest(requestRecordId, { reason }, actorUser) {
  const reqRecord = await getOne(TABLES.REQUESTS(), requestRecordId);
  if (!reqRecord) throw new Error('Request not found');
  const reqData = toRequest(reqRecord);

  await updateOne(TABLES.REQUESTS(), requestRecordId, {
    'Request Status': { text: REQUEST_STATUS.REJECTED, type: 'text' },
    'TL Decision':    'Rejected',
    'TL Employee ID': actorUser.employeeId,
    'TL Remarks':     reason || '',
    'TL Decision Date': Date.now(),
  });

  await audit.log({
    ...actorUser, action: AUDIT_ACTIONS.REQUEST_REJECTED,
    entityType: 'Request', entityId: requestRecordId,
    prevValue: { status: reqData.requestStatus }, newValue: { status: REQUEST_STATUS.REJECTED, reason },
  });

  const empUser = await usrSvc.getUserByEmployeeId(reqData.employeeId);
  await notif.notifyRequestRejected({
    employeeName: reqData.employeeName,
    employeeId:   reqData.employeeId,
    email:        empUser?.email || '',
    brand:        reqData.preferredBrand,
    model:        reqData.preferredModel,
    reason:       reason || 'No reason provided',
  });

  // Feishu chat notification to employee
  if (empUser?.email) {
    bot.notifyRequesterRejected({
      email:        empUser.email,
      requesterName:reqData.employeeName,
      brand:        reqData.preferredBrand || '',
      model:        reqData.preferredModel || '',
      reason:       reason || 'No reason provided',
      holderName:   actorUser.fullName,
    }).catch(e => console.error('[Bot] notifyRequesterRejected:', e.message));
  }

  return { success: true };
}

// ── Ask for clarification ─────────────────────────────────────────────────────
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
