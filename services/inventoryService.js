// services/inventoryService.js — v3
// Optimized bulk upload: parallel duplicate check + batch insert in chunks

const { v4: uuid }  = require('uuid');
const XLSX          = require('xlsx');
const { listAll, listPage, getOne, createOne, updateOne, batchCreate, fieldText, selectText }
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
    brand:              selectText(f['Brand'])            || fieldText(f['Brand'])            || '',
    deviceModel:        fieldText(f['Device Model'])      || '',
    sampleHwType:       selectText(f['Sample / HW Type']) || fieldText(f['Sample / HW Type']) || '',
    imei1:              fieldText(f['IMEI1'])              || '',
    imei2:              fieldText(f['IMEI2'])              || '',
    vcId:               fieldText(f['VC ID'])              || '',
    serialNumber:       fieldText(f['Serial Number'])      || '',
    color:              fieldText(f['Color'])              || '',
    storageRamVariant:  fieldText(f['Storage / RAM Variant']) || '',
    sampleReceivedDate: f['Sample Received Date']          || null,
    warehouseLocation:  fieldText(f['Warehouse / Location']) || '',
    inventoryHolder:    fieldText(f['Inventory Holder'])   || '',
    deviceStatus:       selectText(f['Device Status'])     || '',
    assignedTo:         fieldText(f['Assigned To'])        || '',
    employeeId:         fieldText(f['Employee ID'])        || '',
    assignedDate:       f['Assigned Date']                 || null,
    expectedReturnDate: f['Expected Return Date']          || null,
    actualReturnDate:   f['Actual Return Date']            || null,
    conditionOnReturn:  fieldText(f['Condition on Return'])|| '',
    uploadBatchId:      fieldText(f['Upload Batch ID'])    || '',
    remarks:            fieldText(f['Remarks'])            || '',
    createdAt:          f['Created At']                    || null,
    lastModifiedAt:     f['Last Modified At']              || null,
  };
}

function toFields(data) {
  const f = {};
  if (data.brand             !== undefined) f['Brand']                = data.brand;
  if (data.deviceModel       !== undefined) f['Device Model']         = data.deviceModel;
  if (data.sampleHwType      !== undefined) f['Sample / HW Type']    = data.sampleHwType;
  if (data.imei1             !== undefined) f['IMEI1']                = data.imei1;
  if (data.imei2             !== undefined) f['IMEI2']                = data.imei2;
  if (data.vcId              !== undefined) f['VC ID']                = data.vcId;
  if (data.serialNumber      !== undefined) f['Serial Number']        = data.serialNumber;
  if (data.color             !== undefined) f['Color']                = data.color;
  if (data.storageRamVariant !== undefined) f['Storage / RAM Variant']= data.storageRamVariant;
  if (data.warehouseLocation !== undefined) f['Warehouse / Location'] = data.warehouseLocation;
  if (data.inventoryHolder   !== undefined) f['Inventory Holder']     = data.inventoryHolder;
  if (data.remarks           !== undefined) f['Remarks']              = data.remarks;
  if (data.uploadBatchId     !== undefined) f['Upload Batch ID']      = data.uploadBatchId;
  if (data.assignedTo        !== undefined) f['Assigned To']          = data.assignedTo;
  if (data.employeeId        !== undefined) f['Employee ID']          = data.employeeId;
  if (data.conditionOnReturn !== undefined) f['Condition on Return']  = data.conditionOnReturn;
  if (data.deviceStatus      !== undefined) f['Device Status']        = { text: data.deviceStatus, type: 'text' };
  if (data.sampleReceivedDate!== undefined) f['Sample Received Date'] = data.sampleReceivedDate;
  if (data.assignedDate      !== undefined) f['Assigned Date']        = data.assignedDate;
  if (data.expectedReturnDate!== undefined) f['Expected Return Date'] = data.expectedReturnDate;
  if (data.actualReturnDate  !== undefined) f['Actual Return Date']   = data.actualReturnDate;
  return f;
}

// ── MANDATORY FIELDS ──────────────────────────────────────────────────────────
const REQUIRED_COLS = [
  'Brand', 'Device Model', 'Sample / HW Type', 'IMEI1',
  'Warehouse / Location', 'Inventory Holder', 'Assigned Date'
];

// ── OPTIMIZED BULK DUPLICATE CHECK ───────────────────────────────────────────
// Fetch ALL existing IMEI1, IMEI2, VC ID values in ONE API call
// then do in-memory lookup — much faster than one-by-one queries
async function buildExistingIndex() {
  const all = await listAll(TABLES.INVENTORY());
  const imei1Set = new Set();
  const imei2Set = new Set();
  const vcIdSet  = new Set();
  for (const r of all) {
    const f = r.fields || {};
    const i1 = fieldText(f['IMEI1']).trim();
    const i2 = fieldText(f['IMEI2']).trim();
    const vc = fieldText(f['VC ID']).trim();
    if (i1) imei1Set.add(i1);
    if (i2) imei2Set.add(i2);
    if (vc) vcIdSet.add(vc);
  }
  return { imei1Set, imei2Set, vcIdSet };
}

// ── BULK UPLOAD — optimized for 3000+ rows ───────────────────────────────────
async function bulkUpload(fileBuffer, actorUser, adminEmail, progressCb) {
  const batchId  = `BATCH-${Date.now()}-${uuid().slice(0,6).toUpperCase()}`;
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName= workbook.SheetNames.includes('Inventory Upload')
    ? 'Inventory Upload' : workbook.SheetNames[0];
  const sheet    = workbook.Sheets[sheetName];
  const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const summary = {
    batchId, total: rows.length,
    success: 0, failed: 0, duplicates: 0, missingData: 0,
    errors: []
  };

  if (rows.length === 0) return summary;

  // Step 1: Validate all rows first (fast, in-memory)
  progressCb?.('Validating rows...');
  const validRows = [];
  const batchImei1 = new Set();
  const batchImei2 = new Set();
  const batchVcId  = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i + 2;

    // Check mandatory fields
    const missing = REQUIRED_COLS.filter(c => !String(row[c] || '').trim());
    if (missing.length) {
      summary.missingData++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `Missing: ${missing.join(', ')}` });
      continue;
    }

    const imei1 = String(row['IMEI1'] || '').trim();
    const imei2 = String(row['IMEI2'] || '').trim();
    const vcId  = String(row['VC ID']  || '').trim();

    // IMEI length validation
    if (imei1 && imei1.length !== 15) {
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `IMEI1 must be 15 digits, got ${imei1.length}` });
      continue;
    }
    if (imei2 && imei2.length !== 15) {
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `IMEI2 must be 15 digits, got ${imei2.length}` });
      continue;
    }

    // Check within-batch duplicates
    const batchDup = [];
    if (imei1 && batchImei1.has(imei1)) batchDup.push(`IMEI1=${imei1} (duplicate within file)`);
    if (imei2 && batchImei2.has(imei2)) batchDup.push(`IMEI2=${imei2} (duplicate within file)`);
    if (vcId  && batchVcId.has(vcId))   batchDup.push(`VC ID=${vcId} (duplicate within file)`);

    if (batchDup.length) {
      summary.duplicates++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: batchDup.join(', ') });
      continue;
    }

    if (imei1) batchImei1.add(imei1);
    if (imei2) batchImei2.add(imei2);
    if (vcId)  batchVcId.add(vcId);

    // Parse assigned date
    const assignedDateRaw = String(row['Assigned Date'] || '').trim();
    let assignedDate = null;
    if (assignedDateRaw) {
      const d = new Date(assignedDateRaw);
      if (!isNaN(d)) assignedDate = d.getTime();
    }

    validRows.push({ rowNum, imei1, imei2, vcId, assignedDate, raw: row });
  }

  // Step 2: ONE bulk fetch to get all existing records (instead of N queries)
  progressCb?.(`Checking ${validRows.length} valid rows against database...`);
  const { imei1Set, imei2Set, vcIdSet } = await buildExistingIndex();

  // Step 3: Filter out DB duplicates
  const toInsert = [];
  const dupAlerts = [];

  for (const { rowNum, imei1, imei2, vcId, assignedDate, raw } of validRows) {
    const dbDups = [];
    if (imei1 && imei1Set.has(imei1)) dbDups.push(`IMEI1=${imei1}`);
    if (imei2 && imei2Set.has(imei2)) dbDups.push(`IMEI2=${imei2}`);
    if (vcId  && vcIdSet.has(vcId))   dbDups.push(`VC ID=${vcId}`);

    if (dbDups.length) {
      summary.duplicates++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `Duplicate in DB: ${dbDups.join(', ')}` });
      dupAlerts.push({ field: dbDups[0].split('=')[0], value: dbDups[0].split('=')[1], row: rowNum });
      await audit.logDuplicate({
        batchId,
        fieldName: dbDups.map(d=>d.split('=')[0]).join(','),
        value:     dbDups.map(d=>d.split('=')[1]).join(','),
        rowData:   JSON.stringify(raw).slice(0, 500),
        blockedBy: actorUser?.employeeId,
      });
      continue;
    }

    const assignedTo = String(raw['Assigned To'] || '').trim();
    toInsert.push({
      brand:             String(raw['Brand']).trim(),
      deviceModel:       String(raw['Device Model']).trim(),
      sampleHwType:      String(raw['Sample / HW Type']).trim(),
      imei1,
      imei2:             imei2 || '',
      vcId:              vcId  || '',
      serialNumber:      String(raw['Serial Number'] || '').trim(),
      color:             String(raw['Color'] || '').trim(),
      storageRamVariant: String(raw['Storage / RAM Variant'] || '').trim(),
      warehouseLocation: String(raw['Warehouse / Location']).trim(),
      inventoryHolder:   String(raw['Inventory Holder']).trim(),
      assignedTo,
      assignedDate,
      remarks:           String(raw['Remarks'] || '').trim(),
      deviceStatus:      assignedTo ? DEVICE_STATUS.ASSIGNED : DEVICE_STATUS.NEW,
      uploadBatchId:     batchId,
    });
  }

  // Step 4: Insert in chunks of 500 (Feishu limit) with progress
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    progressCb?.(`Inserting records ${i + 1}–${Math.min(i + CHUNK, toInsert.length)} of ${toInsert.length}...`);
    const result = await batchCreate(TABLES.INVENTORY(), chunk.map(toFields));
    inserted += result.length;
  }

  summary.success = inserted;
  summary.failed  = rows.length - inserted;

  // Audit + notify
  await audit.log({
    ...actorUser,
    action: AUDIT_ACTIONS.UPLOAD,
    entityType: 'Inventory',
    entityId: batchId,
    newValue: { total: rows.length, inserted, duplicates: summary.duplicates }
  });

  if (dupAlerts.length && adminEmail) {
    await notif.notifyDuplicateUpload({
      adminEmail, adminId: actorUser?.employeeId, batchId, duplicates: dupAlerts
    });
  }

  return summary;
}

// ── Single device create ──────────────────────────────────────────────────────
async function createDevice(data, actorUser) {
  // Quick duplicate check for single entry
  const existing = await listAll(TABLES.INVENTORY());
  const dups = [];
  for (const r of existing) {
    const f = r.fields || {};
    if (data.imei1 && fieldText(f['IMEI1']) === data.imei1) dups.push({ field: 'IMEI1', value: data.imei1 });
    if (data.imei2 && fieldText(f['IMEI2']) === data.imei2) dups.push({ field: 'IMEI2', value: data.imei2 });
    if (data.vcId  && fieldText(f['VC ID'])  === data.vcId)  dups.push({ field: 'VC ID',  value: data.vcId  });
    if (dups.length) break;
  }
  if (dups.length) {
    await audit.logDuplicate({ fieldName: dups[0].field, value: dups[0].value, rowData: data, blockedBy: actorUser?.employeeId });
    return { success: false, duplicates: dups };
  }
  const record = await createOne(TABLES.INVENTORY(), toFields({ ...data, deviceStatus: data.deviceStatus || DEVICE_STATUS.NEW }));
  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.UPLOAD, entityType: 'Inventory', entityId: record.record_id, newValue: data });
  return { success: true, device: toDevice(record) };
}

async function listDevices({ status, brand, location, assignedTo, pageSize = 50, pageToken } = {}) {
  const filters = [];
  if (status)     filters.push(`CurrentValue.[Device Status] = "${status}"`);
  if (brand)      filters.push(`CurrentValue.[Brand] = "${brand}"`);
  if (location)   filters.push(`CurrentValue.[Warehouse / Location] = "${location}"`);
  if (assignedTo) filters.push(`CurrentValue.[Employee ID] = "${assignedTo}"`);
  const filter = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];
  const result = await listPage(TABLES.INVENTORY(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toDevice) };
}

async function getDevice(recordId) {
  const r = await getOne(TABLES.INVENTORY(), recordId);
  return r ? toDevice(r) : null;
}

async function updateDevice(recordId, data, actorUser) {
  const existing = await getDevice(recordId);
  if (!existing) throw new Error('Device not found');
  const record = await updateOne(TABLES.INVENTORY(), recordId, toFields(data));
  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.STATUS_CHANGE, entityType: 'Inventory', entityId: recordId, prevValue: existing, newValue: data });
  return toDevice(record);
}

async function getDashboardStats() {
  const all = await listAll(TABLES.INVENTORY());
  const devices = all.map(toDevice);
  const byStatus = {};
  for (const s of ['New','Available','Assigned','Returned','Damaged','Scrapped']) byStatus[s] = 0;
  devices.forEach(d => { if (byStatus[d.deviceStatus] !== undefined) byStatus[d.deviceStatus]++; });
  const byBrand = {};
  devices.forEach(d => { byBrand[d.brand] = (byBrand[d.brand] || 0) + 1; });
  const overdue = devices.filter(d =>
    d.deviceStatus === 'Assigned' && d.expectedReturnDate && d.expectedReturnDate < Date.now()
  );
  return { total: devices.length, byStatus, byBrand, overdueCount: overdue.length };
}

module.exports = { listDevices, getDevice, createDevice, updateDevice, bulkUpload, getDashboardStats, toDevice };
