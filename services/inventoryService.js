// services/inventoryService.js — v4
// FUZZY COLUMN MATCHING: accepts slight header variations in uploaded Excel files
// e.g. "Sample/HW Type", "HW Type", "IMEI 1", "Assigned date" all work

const { v4: uuid }  = require('uuid');
const XLSX          = require('xlsx');
const { listAll, listPage, getOne, createOne, updateOne, batchCreate, fieldText, selectText }
                    = require('../utils/bitable');
const { TABLES, DEVICE_STATUS, AUDIT_ACTIONS }
                    = require('../config/constants');
const audit         = require('./auditService');
const notif         = require('./notificationService');

// ── Fuzzy column resolver ─────────────────────────────────────────────────────
// Maps many possible header variations to canonical field names
const COLUMN_ALIASES = {
  'Brand':                   ['brand'],
  'Device Model':            ['device model', 'model', 'devicemodel'],
  'Sample / HW Type':        ['sample / hw type', 'sample/hw type', 'hw type', 'hwtype',
                               'sample hw type', 'nple / hw typ', 'sample/hwtype', 'type'],
  'IMEI1':                   ['imei1', 'imei 1', 'imei-1', 'imei_1', 'primary imei', 'imei'],
  'IMEI2':                   ['imei2', 'imei 2', 'imei-2', 'imei_2', 'secondary imei'],
  'Serial Number':           ['serial number', 'serial no', 'serial', 'serialnumber', 's/n', 'sn'],
  'VC ID':                   ['vc id', 'vcid', 'vc_id', 'verification id', 'vc'],
  'Color':                   ['color', 'colour'],
  'Storage / RAM Variant':   ['storage / ram variant', 'storage/ram variant', 'storage / ram',
                               'storage/ram', 'ram/storage', 'variant', 'storage', 'ram',
                               'storage / ram varian', 'storage/ram varian'],
  'Assigned Date':           ['assigned date', 'assigneddate', 'assigned_date', 'date assigned',
                               'assignment date'],
  'Sample Received Date':    ['sample received date', 'received date', 'receiveddate',
                               'date received', 'receipt date'],
  'Warehouse / Location':    ['warehouse / location', 'warehouse/location', 'location',
                               'warehouse', 'storage location'],
  'Inventory Holder':        ['inventory holder', 'inventoryholder', 'holder', 'custodian',
                               'in-charge', 'incharge'],
  'Assigned To':             ['assigned to', 'assignedto', 'assigned_to', 'employee'],
  'Remarks':                 ['remarks', 'notes', 'comment', 'comments', 'note'],
};

/**
 * Build a lookup map: normalised_header_string → canonical_field_name
 * Called once per upload to map actual Excel headers to our canonical names.
 */
function buildColumnMap(excelHeaders) {
  const map = {}; // canonical → actual excel header
  const normalise = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '').trim();

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const header of excelHeaders) {
      const norm = normalise(header);
      if (norm === normalise(canonical) || aliases.includes(norm)) {
        map[canonical] = header; // use actual Excel header for row access
        break;
      }
    }
  }
  return map;
}

/** Get cell value using canonical field name via the column map */
function col(row, canonical, colMap) {
  const actualHeader = colMap[canonical];
  if (!actualHeader) return '';
  return String(row[actualHeader] ?? '').trim();
}

// ── Field mapper (Bitable record → JS object) ─────────────────────────────────
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
    deviceStatus:       selectText(f['Device Status'])     || fieldText(f['Device Status'])   || '',
    assignedTo:         fieldText(f['Assigned To'])        || '',
    employeeId:         fieldText(f['Employee ID'])        || '',
    assignedDate:       f['Assigned Date']                 || null,
    expectedReturnDate: f['Expected Return Date']          || null,
    actualReturnDate:   f['Actual Return Date']            || null,
    conditionOnReturn:  fieldText(f['Condition on Return'])|| '',
    uploadBatchId:      fieldText(f['Upload Batch ID'])    || '',
    remarks:            fieldText(f['Remarks'])            || '',
    createdAt:          f['Created At']                    || null,
    // Keep raw fields for debugging display issues
    _rawBrand:          f['Brand'],
    _rawModel:          f['Device Model'],
    _rawImei1:          f['IMEI1'],
    _rawStatus:         f['Device Status'],
  };
}

function toFields(data) {
  const f = {};
  if (data.brand             !== undefined) f['Brand']                = data.brand;
  if (data.deviceModel       !== undefined) f['Device Model']         = data.deviceModel;
  if (data.sampleHwType      !== undefined) f['Sample / HW Type']    = data.sampleHwType;
  if (data.imei1             !== undefined) f['IMEI1']                = String(data.imei1);
  if (data.imei2             !== undefined) f['IMEI2']                = String(data.imei2);
  if (data.vcId              !== undefined) f['VC ID']                = String(data.vcId);
  if (data.serialNumber      !== undefined) f['Serial Number']        = String(data.serialNumber);
  if (data.color             !== undefined) f['Color']                = data.color;
  if (data.storageRamVariant !== undefined) f['Storage / RAM Variant']= data.storageRamVariant;
  if (data.warehouseLocation !== undefined) f['Warehouse / Location'] = data.warehouseLocation;
  if (data.inventoryHolder   !== undefined) f['Inventory Holder']     = data.inventoryHolder;
  if (data.assignedTo        !== undefined) f['Assigned To']          = data.assignedTo;
  if (data.employeeId        !== undefined) f['Employee ID']          = data.employeeId;
  if (data.remarks           !== undefined) f['Remarks']              = data.remarks;
  if (data.uploadBatchId     !== undefined) f['Upload Batch ID']      = data.uploadBatchId;
  if (data.conditionOnReturn !== undefined) f['Condition on Return']  = data.conditionOnReturn;
  if (data.deviceStatus      !== undefined) f['Device Status']        = { text: data.deviceStatus, type: 'text' };
  if (data.sampleReceivedDate!== undefined && data.sampleReceivedDate) f['Sample Received Date'] = data.sampleReceivedDate;
  if (data.assignedDate      !== undefined && data.assignedDate)       f['Assigned Date']        = data.assignedDate;
  if (data.expectedReturnDate!== undefined && data.expectedReturnDate) f['Expected Return Date'] = data.expectedReturnDate;
  if (data.actualReturnDate  !== undefined && data.actualReturnDate)   f['Actual Return Date']   = data.actualReturnDate;
  return f;
}

// ── Parse date string → timestamp ────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  // Handle Excel serial number dates
  if (/^\d{5}$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) return new Date(d.y, d.m - 1, d.d).getTime();
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.getTime();
}

// ── Mandatory fields ──────────────────────────────────────────────────────────
const MANDATORY = ['Brand', 'Device Model', 'Sample / HW Type', 'IMEI1',
                   'Warehouse / Location', 'Inventory Holder', 'Assigned Date'];

// ── Build existing DB index for fast duplicate checking ───────────────────────
async function buildExistingIndex() {
  const all = await listAll(TABLES.INVENTORY());
  const imei1Set = new Set(), imei2Set = new Set(), vcIdSet = new Set();
  for (const r of all) {
    const f = r.fields || {};
    const i1 = String(fieldText(f['IMEI1']) || '').trim();
    const i2 = String(fieldText(f['IMEI2']) || '').trim();
    const vc = String(fieldText(f['VC ID'])  || '').trim();
    if (i1) imei1Set.add(i1);
    if (i2) imei2Set.add(i2);
    if (vc) vcIdSet.add(vc);
  }
  return { imei1Set, imei2Set, vcIdSet };
}

// ── BULK UPLOAD ───────────────────────────────────────────────────────────────
async function bulkUpload(fileBuffer, actorUser, adminEmail, progressCb) {
  const batchId  = `BATCH-${Date.now()}-${uuid().slice(0, 6).toUpperCase()}`;
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  // Prefer "Inventory Upload" sheet, else first sheet
  const sheetName = workbook.SheetNames.includes('Inventory Upload')
    ? 'Inventory Upload' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Read with header row = 1, defval = '' so empty cells don't disappear
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  const summary = { batchId, total: rows.length, success: 0, failed: 0,
                    duplicates: 0, missingData: 0, errors: [] };

  if (rows.length === 0) {
    summary.errors.push({ row: 1, reason: 'File appears empty or headers not found. Please use the official template.' });
    return summary;
  }

  // Build column map from actual headers
  const excelHeaders = Object.keys(rows[0]);
  const colMap = buildColumnMap(excelHeaders);

  // Log which columns were detected
  progressCb?.(`Detected ${excelHeaders.length} columns. Mapping: ${Object.keys(colMap).join(', ')}`);

  // Warn if mandatory columns are missing
  // Log column map for debugging
  progressCb?.(`Column mapping: ${JSON.stringify(colMap)}`);
  const missingCols = MANDATORY.filter(m => !colMap[m]);
  if (missingCols.length > 0) {
    summary.errors.push({
      row: 1,
      reason: `Cannot find these required columns: ${missingCols.join(', ')}. ` +
              `Please use the official template. Found headers: ${excelHeaders.join(', ')}`
    });
    summary.failed = rows.length;
    return summary;
  }

  // ── Step 1: Validate all rows in memory ──────────────────────────────────
  progressCb?.(`Validating ${rows.length} rows...`);
  const validRows = [];
  const batchImei1 = new Set(), batchImei2 = new Set(), batchVcId = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i + 2;

    // Check mandatory fields
    const missing = MANDATORY.filter(m => !col(row, m, colMap));
    if (missing.length) {
      summary.missingData++;
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `Missing required: ${missing.join(', ')}` });
      continue;
    }

    const imei1 = col(row, 'IMEI1', colMap).replace(/\s/g, '');
    const imei2 = col(row, 'IMEI2', colMap).replace(/\s/g, '');
    const vcId  = col(row, 'VC ID',  colMap);

    // IMEI validation — only digits, exactly 15
    if (!/^\d{15}$/.test(imei1)) {
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `IMEI1 "${imei1}" must be exactly 15 digits (found ${imei1.length})` });
      continue;
    }
    if (imei2 && !/^\d{15}$/.test(imei2)) {
      summary.failed++;
      summary.errors.push({ row: rowNum, reason: `IMEI2 "${imei2}" must be exactly 15 digits if provided` });
      continue;
    }

    // Within-batch duplicates
    const batchDups = [];
    if (batchImei1.has(imei1)) batchDups.push(`IMEI1 ${imei1} (duplicate within this file)`);
    if (imei2 && batchImei2.has(imei2)) batchDups.push(`IMEI2 ${imei2} (duplicate within this file)`);
    if (vcId  && batchVcId.has(vcId))   batchDups.push(`VC ID ${vcId} (duplicate within this file)`);
    if (batchDups.length) {
      summary.duplicates++; summary.failed++;
      summary.errors.push({ row: rowNum, reason: batchDups.join('; ') });
      continue;
    }
    batchImei1.add(imei1);
    if (imei2) batchImei2.add(imei2);
    if (vcId)  batchVcId.add(vcId);

    validRows.push({ rowNum, imei1, imei2, vcId, row });
  }

  // ── Step 2: ONE DB read for all existing duplicates ───────────────────────
  progressCb?.(`Checking ${validRows.length} valid rows against database...`);
  const { imei1Set, imei2Set, vcIdSet } = await buildExistingIndex();

  // ── Step 3: Build insert list ─────────────────────────────────────────────
  const toInsert = [];
  for (const { rowNum, imei1, imei2, vcId, row } of validRows) {
    const dbDups = [];
    if (imei1Set.has(imei1)) dbDups.push(`IMEI1 ${imei1} already in database`);
    if (imei2 && imei2Set.has(imei2)) dbDups.push(`IMEI2 ${imei2} already in database`);
    if (vcId  && vcIdSet.has(vcId))   dbDups.push(`VC ID ${vcId} already in database`);
    if (dbDups.length) {
      summary.duplicates++; summary.failed++;
      summary.errors.push({ row: rowNum, reason: dbDups.join('; ') });
      await audit.logDuplicate({
        batchId,
        fieldName: dbDups.map(d => d.split(' ')[0] + ' ' + d.split(' ')[1]).join(','),
        value:     dbDups.map(d => d.split(' ')[2]).join(','),
        rowData:   JSON.stringify(row).slice(0, 500),
        blockedBy: actorUser?.employeeId,
      });
      continue;
    }

    const assignedTo = col(row, 'Assigned To', colMap);
    toInsert.push({
      brand:             col(row, 'Brand',                 colMap),
      deviceModel:       col(row, 'Device Model',          colMap),
      sampleHwType:      col(row, 'Sample / HW Type',      colMap),
      imei1,
      imei2:             imei2 || '',
      vcId:              vcId  || '',
      serialNumber:      col(row, 'Serial Number',         colMap),
      color:             col(row, 'Color',                 colMap),
      storageRamVariant: col(row, 'Storage / RAM Variant', colMap),
      warehouseLocation: col(row, 'Warehouse / Location',  colMap),
      inventoryHolder:   col(row, 'Inventory Holder',      colMap),
      assignedTo,
      assignedDate:      parseDate(col(row, 'Assigned Date',          colMap)),
      sampleReceivedDate:parseDate(col(row, 'Sample Received Date',   colMap)),
      remarks:           col(row, 'Remarks', colMap),
      deviceStatus:      assignedTo ? DEVICE_STATUS.ASSIGNED : DEVICE_STATUS.NEW,
      uploadBatchId:     batchId,
    });
  }

  // ── Step 4: Batch insert 500 at a time ────────────────────────────────────
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const chunkEnd = Math.min(i + CHUNK, toInsert.length);
    progressCb?.(`Inserting records ${i + 1}–${chunkEnd} of ${toInsert.length}...`);
    try {
      const mappedFields = chunk.map(toFields);
      // Log first record for debugging
      console.log('[bulkUpload] Sending', mappedFields.length, 'records. First:', JSON.stringify(mappedFields[0]));
      const result = await batchCreate(TABLES.INVENTORY(), mappedFields);
      console.log('[bulkUpload] batchCreate returned', result.length, 'records');
      summary.success += result.length;
      if (result.length < chunk.length) {
        const missed = chunk.length - result.length;
        summary.failed += missed;
        summary.errors.push({
          row: `rows ${i + 2}–${chunkEnd + 1}`,
          reason: `Batch insert: ${result.length}/${chunk.length} succeeded. ${missed} records may have duplicate IMEI or invalid fields.`
        });
      }
    } catch (batchErr) {
      summary.failed += chunk.length;
      const errMsg = batchErr.message || String(batchErr);
      console.error('[bulkUpload] batchCreate THREW:', errMsg);
      summary.errors.push({
        row: `rows ${i + 2}–${chunkEnd + 1}`,
        reason: `Batch insert error: ${errMsg}`
      });
      progressCb?.(`❌ Batch error: ${errMsg}`);
    }
  }

  // All failures tracked inside the batch loop above

  await audit.log({
    ...actorUser, action: AUDIT_ACTIONS.UPLOAD,
    entityType: 'Inventory', entityId: batchId,
    newValue: { total: rows.length, inserted: summary.success, duplicates: summary.duplicates },
  });

  return summary;
}

// ── Single device ─────────────────────────────────────────────────────────────
async function createDevice(data, actorUser) {
  const existing = await listAll(TABLES.INVENTORY());
  const dups = [];
  for (const r of existing) {
    const f = r.fields || {};
    if (data.imei1 && fieldText(f['IMEI1']) === String(data.imei1)) dups.push({ field: 'IMEI1', value: data.imei1 });
    if (data.imei2 && fieldText(f['IMEI2']) === String(data.imei2)) dups.push({ field: 'IMEI2', value: data.imei2 });
    if (data.vcId  && fieldText(f['VC ID'])  === String(data.vcId))  dups.push({ field: 'VC ID',  value: data.vcId });
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
  const all     = await listAll(TABLES.INVENTORY());
  const devices = all.map(toDevice);
  const byStatus = {};
  for (const s of ['New', 'Available', 'Assigned', 'Returned', 'Damaged', 'Scrapped']) byStatus[s] = 0;
  devices.forEach(d => { if (byStatus[d.deviceStatus] !== undefined) byStatus[d.deviceStatus]++; });
  const byBrand = {};
  devices.forEach(d => { byBrand[d.brand] = (byBrand[d.brand] || 0) + 1; });
  const overdue = devices.filter(d =>
    d.deviceStatus === 'Assigned' && d.expectedReturnDate && d.expectedReturnDate < Date.now()
  );
  return { total: devices.length, byStatus, byBrand, overdueCount: overdue.length };
}

module.exports = { listDevices, getDevice, createDevice, updateDevice, bulkUpload, getDashboardStats, toDevice };
