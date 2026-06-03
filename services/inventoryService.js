// services/inventoryService.js
// Handles: list, get, create, bulk upload, status update, amendment.
// DUPLICATE DETECTION on IMEI1, IMEI2, VC ID before any insert.

const { v4: uuid }  = require('uuid');
const XLSX          = require('xlsx');
const { listAll, listPage, getOne, createOne, updateOne, batchCreate, findFirst, fieldText, selectText }
                    = require('../utils/bitable');
const { TABLES, DEVICE_STATUS, AUDIT_ACTIONS }
                    = require('../config/constants');
const audit         = require('./auditService');
const notif         = require('./notificationService');

// ── Field mapper ──────────────────────────────────────────────────────────────
function toDevice(record) {
  const f = record.fields || {};
  return {
    recordId:           record.record_id,
    inventoryId:        fieldText(f['Inventory ID']),
    brand:              fieldText(f['Brand']),
    deviceModel:        fieldText(f['Device Model']),
    sampleHwType:       fieldText(f['Sample / HW Type']),
    hwStage:            selectText(f['HW Stage']),
    imei1:              fieldText(f['IMEI1']),
    imei2:              fieldText(f['IMEI2']),
    vcId:               fieldText(f['VC ID']),
    color:              fieldText(f['Color']),
    storageRamVariant:  fieldText(f['Storage / RAM Variant']),
    sampleReceivedDate: f['Sample Received Date'] || null,
    warehouseLocation:  fieldText(f['Warehouse / Location']),
    inventoryHolder:    fieldText(f['Inventory Holder']),
    deviceStatus:       selectText(f['Device Status']),
    assignedTo:         fieldText(f['Assigned To']),
    employeeId:         fieldText(f['Employee ID']),
    assignedDate:       f['Assigned Date'] || null,
    expectedReturnDate: f['Expected Return Date'] || null,
    actualReturnDate:   f['Actual Return Date'] || null,
    conditionOnReturn:  fieldText(f['Condition on Return']),
    uploadBatchId:      fieldText(f['Upload Batch ID']),
    remarks:            fieldText(f['Remarks']),
    createdAt:          f['Created At'] || null,
    lastModifiedAt:     f['Last Modified At'] || null,
  };
}

function toFields(data) {
  const f = {};
  const map = {
    brand:              'Brand',
    deviceModel:        'Device Model',
    sampleHwType:       'Sample / HW Type',
    hwStage:            'HW Stage',
    imei1:              'IMEI1',
    imei2:              'IMEI2',
    vcId:               'VC ID',
    color:              'Color',
    storageRamVariant:  'Storage / RAM Variant',
    warehouseLocation:  'Warehouse / Location',
    inventoryHolder:    'Inventory Holder',
    remarks:            'Remarks',
    uploadBatchId:      'Upload Batch ID',
    assignedTo:         'Assigned To',
    employeeId:         'Employee ID',
    conditionOnReturn:  'Condition on Return',
  };
  for (const [key, fieldName] of Object.entries(map)) {
    if (data[key] !== undefined) f[fieldName] = data[key];
  }
  if (data.deviceStatus !== undefined) f['Device Status'] = { text: data.deviceStatus, type: 'text' };
  if (data.sampleReceivedDate !== undefined) f['Sample Received Date'] = data.sampleReceivedDate;
  if (data.assignedDate       !== undefined) f['Assigned Date']        = data.assignedDate;
  if (data.expectedReturnDate !== undefined) f['Expected Return Date'] = data.expectedReturnDate;
  if (data.actualReturnDate   !== undefined) f['Actual Return Date']   = data.actualReturnDate;
  return f;
}

// ── Duplicate check ───────────────────────────────────────────────────────────
async function checkDuplicate(imei1, imei2, vcId) {
  const duplicates = [];
  if (imei1) {
    const r = await findFirst(TABLES.INVENTORY(), `CurrentValue.[IMEI1] = "${imei1}"`);
    if (r) duplicates.push({ field: 'IMEI1', value: imei1 });
  }
  if (imei2) {
    const r = await findFirst(TABLES.INVENTORY(), `CurrentValue.[IMEI2] = "${imei2}"`);
    if (r) duplicates.push({ field: 'IMEI2', value: imei2 });
  }
  if (vcId) {
    const r = await findFirst(TABLES.INVENTORY(), `CurrentValue.[VC ID] = "${vcId}"`);
    if (r) duplicates.push({ field: 'VC ID', value: vcId });
  }
  return duplicates;
}

// ── Service methods ───────────────────────────────────────────────────────────

async function listDevices({ status, brand, location, hwStage, assignedTo, pageSize = 50, pageToken } = {}) {
  const filters = [];
  if (status)     filters.push(`CurrentValue.[Device Status] = "${status}"`);
  if (brand)      filters.push(`CurrentValue.[Brand] = "${brand}"`);
  if (location)   filters.push(`CurrentValue.[Warehouse / Location] = "${location}"`);
  if (hwStage)    filters.push(`CurrentValue.[HW Stage] = "${hwStage}"`);
  if (assignedTo) filters.push(`CurrentValue.[Employee ID] = "${assignedTo}"`);

  const filter = filters.length > 1  ? `AND(${filters.join(',')})` :
                 filters.length === 1 ? filters[0] : undefined;

  const result = await listPage(TABLES.INVENTORY(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toDevice) };
}

async function getDevice(recordId) {
  const r = await getOne(TABLES.INVENTORY(), recordId);
  return r ? toDevice(r) : null;
}

async function createDevice(data, actorUser) {
  const dups = await checkDuplicate(data.imei1, data.imei2, data.vcId);
  if (dups.length) {
    await audit.logDuplicate({ fieldName: dups.map(d => d.field).join(', '), value: dups.map(d => d.value).join(', '), rowData: data, blockedBy: actorUser?.employeeId });
    return { success: false, duplicates: dups };
  }
  const record = await createOne(TABLES.INVENTORY(), toFields({ ...data, deviceStatus: data.deviceStatus || DEVICE_STATUS.NEW }));
  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.UPLOAD, entityType: 'Inventory', entityId: record.record_id, newValue: data });
  return { success: true, device: toDevice(record) };
}

async function updateDevice(recordId, data, actorUser) {
  const existing = await getDevice(recordId);
  if (!existing) throw new Error('Device not found');
  const record = await updateOne(TABLES.INVENTORY(), recordId, toFields(data));
  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.STATUS_CHANGE, entityType: 'Inventory', entityId: recordId, prevValue: existing, newValue: data });
  return toDevice(record);
}

// ── Bulk Upload ───────────────────────────────────────────────────────────────

const REQUIRED_COLS = ['Brand','Device Model','Sample / HW Type','HW Stage','IMEI1','Color','Storage / RAM Variant','Warehouse / Location','Inventory Holder'];

async function bulkUpload(fileBuffer, actorUser, adminEmail) {
  const batchId   = `BATCH-${Date.now()}-${uuid().slice(0,6).toUpperCase()}`;
  const workbook  = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheet     = workbook.Sheets[workbook.SheetNames[0]];
  const rows      = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const summary = { batchId, total: rows.length, success: 0, failed: 0, duplicates: 0, missingData: 0, errors: [] };
  const toInsert = [];
  const dupAlerts = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed + header row

    // Validate mandatory fields
    const missing = REQUIRED_COLS.filter(c => !row[c] || String(row[c]).trim() === '');
    if (missing.length) {
      summary.missingData++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `Missing: ${missing.join(', ')}`, data: row });
      continue;
    }

    // Duplicate check (against existing DB + within this batch)
    const imei1 = String(row['IMEI1'] || '').trim();
    const imei2 = String(row['IMEI2'] || '').trim();
    const vcId  = String(row['VC ID']  || '').trim();

    const existingDups = await checkDuplicate(imei1, imei2, vcId);
    const batchDups = toInsert.filter(r =>
      (imei1 && r.imei1 === imei1) ||
      (imei2 && r.imei2 === imei2) ||
      (vcId  && r.vcId  === vcId)
    );

    if (existingDups.length || batchDups.length) {
      const dups = [...existingDups, ...batchDups.map(b => ({ field: 'InBatch', value: b.imei1 }))];
      summary.duplicates++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `Duplicate: ${dups.map(d => `${d.field}=${d.value}`).join(', ')}`, data: row });
      await audit.logDuplicate({ batchId, fieldName: dups.map(d=>d.field).join(','), value: dups.map(d=>d.value).join(','), rowData: row, blockedBy: actorUser?.employeeId });
      dupAlerts.push({ field: dups[0].field, value: dups[0].value, row: rowNum });
      continue;
    }

    toInsert.push({
      brand:             String(row['Brand']).trim(),
      deviceModel:       String(row['Device Model']).trim(),
      sampleHwType:      String(row['Sample / HW Type']).trim(),
      hwStage:           String(row['HW Stage']).trim(),
      imei1,
      imei2,
      vcId,
      color:             String(row['Color'] || '').trim(),
      storageRamVariant: String(row['Storage / RAM Variant'] || '').trim(),
      warehouseLocation: String(row['Warehouse / Location']).trim(),
      inventoryHolder:   String(row['Inventory Holder']).trim(),
      remarks:           String(row['Remarks'] || '').trim(),
      deviceStatus:      DEVICE_STATUS.NEW,
      uploadBatchId:     batchId,
    });
  }

  // Batch insert valid rows
  if (toInsert.length) {
    const inserted = await batchCreate(TABLES.INVENTORY(), toInsert.map(toFields));
    summary.success = inserted.length;
    await audit.log({ ...actorUser, action: AUDIT_ACTIONS.UPLOAD, entityType: 'Inventory', entityId: batchId, newValue: { count: inserted.length } });
  }

  summary.failed = rows.length - summary.success;

  // Notify admin of duplicates
  if (dupAlerts.length && adminEmail) {
    await notif.notifyDuplicateUpload({ adminEmail, adminId: actorUser?.employeeId, batchId, duplicates: dupAlerts });
  }

  return summary;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
async function getDashboardStats() {
  const all = await listAll(TABLES.INVENTORY());
  const devices = all.map(toDevice);
  const byStatus = {};
  for (const s of Object.values(DEVICE_STATUS)) byStatus[s] = 0;
  devices.forEach(d => { if (byStatus[d.deviceStatus] !== undefined) byStatus[d.deviceStatus]++; });

  const byBrand = {};
  devices.forEach(d => { byBrand[d.brand] = (byBrand[d.brand] || 0) + 1; });

  const overdue = devices.filter(d => d.deviceStatus === DEVICE_STATUS.ASSIGNED && d.expectedReturnDate && d.expectedReturnDate < Date.now());

  return { total: devices.length, byStatus, byBrand, overdueCount: overdue.length };
}

module.exports = { listDevices, getDevice, createDevice, updateDevice, bulkUpload, getDashboardStats, checkDuplicate, toDevice };
