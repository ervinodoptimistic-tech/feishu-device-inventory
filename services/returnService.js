// services/returnService.js
const { listPage, getOne, createOne, updateOne, findFirst, fieldText, selectText } = require('../utils/bitable');
const { TABLES, DEVICE_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const audit  = require('./auditService');
const invSvc = require('./inventoryService');

function toReturn(record) {
  const f = record.fields || {};
  return {
    recordId:           record.record_id,
    returnId:           fieldText(f['Return ID']),
    assignmentRecordId: fieldText(f['Assignment Record ID']),
    inventoryRecordId:  fieldText(f['Inventory Record ID']),
    imei1:              fieldText(f['IMEI1']),
    brand:              fieldText(f['Brand']),
    deviceModel:        fieldText(f['Device Model']),
    returnedBy:         fieldText(f['Returned By']),
    employeeId:         fieldText(f['Employee ID']),
    returnDate:         f['Return Date'] || null,
    physicalCondition:  selectText(f['Physical Condition']),
    accessoriesPresent: f['Accessories Present'] === true,
    validatedBy:        fieldText(f['Validated By']),
    conditionRemarks:   fieldText(f['Condition Remarks']),
    newStatus:          fieldText(f['New Status']),
  };
}

async function submitReturn({ inventoryRecordId, physicalCondition, accessoriesPresent, conditionRemarks }, actorUser) {
  const device = await invSvc.getDevice(inventoryRecordId);
  if (!device) throw new Error('Device not found');
  if (device.deviceStatus !== DEVICE_STATUS.ASSIGNED) {
    throw new Error(`Device is not currently assigned (status: ${device.deviceStatus})`);
  }
  // Ensure the returning employee owns this device
  if (actorUser.role === 'Employee' && device.employeeId !== actorUser.employeeId) {
    throw new Error('You can only return devices assigned to you');
  }

  // Find active assignment
  const asgn = await findFirst(TABLES.ASSIGNMENTS(),
    `AND(CurrentValue.[Inventory Record ID] = "${inventoryRecordId}", CurrentValue.[Status] = "Active")`
  );

  // Determine new device status based on condition
  let newDeviceStatus = DEVICE_STATUS.RETURNED;
  if (physicalCondition === 'Major Damage' || physicalCondition === 'Non-Functional') {
    newDeviceStatus = DEVICE_STATUS.DAMAGED;
  }

  const now = Date.now();

  // 1. Create return record
  const returnRecord = await createOne(TABLES.RETURNS(), {
    'Assignment Record ID': asgn?.record_id || '',
    'Inventory Record ID':  inventoryRecordId,
    'IMEI1':               device.imei1,
    'Brand':               device.brand,
    'Device Model':        device.deviceModel,
    'Returned By':         actorUser.fullName,
    'Employee ID':         actorUser.employeeId,
    'Return Date':         now,
    'Physical Condition':  { text: physicalCondition || 'Good', type: 'text' },
    'Accessories Present': accessoriesPresent !== false,
    'Validated By':        '',
    'Condition Remarks':   conditionRemarks || '',
    'New Status':          newDeviceStatus,
  });

  // 2. Update device
  await invSvc.updateDevice(inventoryRecordId, {
    deviceStatus:    newDeviceStatus,
    assignedTo:      '',
    employeeId:      '',
    actualReturnDate: now,
    conditionOnReturn: conditionRemarks || physicalCondition,
  }, actorUser);

  // 3. Close assignment
  if (asgn?.record_id) {
    await updateOne(TABLES.ASSIGNMENTS(), asgn.record_id, {
      'Status': { text: 'Returned', type: 'text' },
    });
  }

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.RETURN, entityType: 'Inventory', entityId: inventoryRecordId, prevValue: { status: DEVICE_STATUS.ASSIGNED }, newValue: { status: newDeviceStatus } });

  // Send thank-you email to employee + notify inventory holder
  try {
    const usrSvc = require('./userService');
    const notif  = require('./notificationService');
    const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const empUser = await usrSvc.getUserByEmployeeId(actorUser.employeeId);
    const allUsers = await usrSvc.listUsers();
    const holder   = allUsers.find(u => u.role === 'InventoryHolder' || u.role === 'Admin');
    await notif.notifyDeviceReturned({
      employeeName: actorUser.fullName,
      employeeId:   actorUser.employeeId,
      email:        empUser?.email || '',
      brand:        device.brand,
      model:        device.deviceModel,
      imei:         device.imei1,
      returnDate:   fmtDate(now),
      condition:    physicalCondition || 'Good',
      holderName:   holder?.fullName  || 'Inventory Team',
      holderEmail:  holder?.email     || '',
      holderId:     holder?.employeeId|| '',
    });

    // Feishu chat notifications
    const bot = require('./feishuBotService');
    // Thank-you to employee
    if (empUser?.email) {
      bot.notifyEmployeeReturned({
        email:        empUser.email,
        employeeName: actorUser.fullName,
        brand:        device.brand,
        model:        device.deviceModel,
        imei:         device.imei1,
        returnDate:   fmtDate(now),
        condition:    physicalCondition || 'Good',
      }).catch(e => console.error('[Bot] notifyEmployeeReturned:', e.message));
    }
    // Alert to inventory holder
    if (holder?.email) {
      bot.notifyHolderReturnReceived({
        holderEmail:  holder.email,
        employeeName: actorUser.fullName,
        employeeId:   actorUser.employeeId,
        brand:        device.brand,
        model:        device.deviceModel,
        imei:         device.imei1,
        condition:    physicalCondition || 'Good',
      }).catch(e => console.error('[Bot] notifyHolderReturnReceived:', e.message));
    }
  } catch(e) { console.error('[Return notification]', e.message); }

  return toReturn(returnRecord);
}

async function validateReturn(returnRecordId, { isValid, validatorRemarks, overrideStatus }, actorUser) {
  const returnRec = await getOne(TABLES.RETURNS(), returnRecordId);
  if (!returnRec) throw new Error('Return record not found');
  const ret = toReturn(returnRec);

  const finalStatus = overrideStatus || ret.newStatus;

  await updateOne(TABLES.RETURNS(), returnRecordId, {
    'Validated By':     actorUser.employeeId,
    'Condition Remarks': validatorRemarks || ret.conditionRemarks,
    'New Status':        finalStatus,
  });

  // Update device to final validated status
  await invSvc.updateDevice(ret.inventoryRecordId, { deviceStatus: finalStatus }, actorUser);

  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.RETURN, entityType: 'Return', entityId: returnRecordId, prevValue: ret.newStatus, newValue: finalStatus });

  return { success: true, finalStatus };
}

async function listReturns({ employeeId, pageSize = 50, pageToken } = {}) {
  const filter = employeeId ? `CurrentValue.[Employee ID] = "${employeeId}"` : undefined;
  const result = await listPage(TABLES.RETURNS(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toReturn) };
}

module.exports = { submitReturn, validateReturn, listReturns };
