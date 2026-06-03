// services/benchmarkService.js
// Handles Competitor/Benchmark device inventory.
// Only accessible to: Admin, BenchmarkViewer, InventoryHolder

const { listPage, listAll, createOne, updateOne, batchCreate, findFirst, fieldText, selectText }
  = require('../utils/bitable');
const { TABLES, AUDIT_ACTIONS } = require('../config/constants');
const audit = require('./auditService');
const XLSX  = require('xlsx');

function toDevice(record) {
  const f = record.fields || {};
  return {
    recordId:        record.record_id,
    competitorBrand: fieldText(f['Competitor Brand']),
    deviceModel:     fieldText(f['Device Model']),
    category:        selectText(f['Category']),
    source:          fieldText(f['Source']),
    receivedDate:    f['Received Date'] || null,
    serialImei:      fieldText(f['Serial Number / IMEI']),
    color:           fieldText(f['Color']),
    storageRam:      fieldText(f['Storage / RAM']),
    location:        fieldText(f['Warehouse / Location']),
    custodian:       fieldText(f['Custodian']),
    purpose:         fieldText(f['Purpose / Test Type']),
    remarks:         fieldText(f['Remarks']),
    createdAt:       f['Created At'] || null,
  };
}

function toFields(data) {
  const f = {};
  if (data.competitorBrand !== undefined) f['Competitor Brand'] = data.competitorBrand;
  if (data.deviceModel     !== undefined) f['Device Model']     = data.deviceModel;
  if (data.category        !== undefined) f['Category']         = { text: data.category, type: 'text' };
  if (data.source          !== undefined) f['Source']           = data.source;
  if (data.receivedDate    !== undefined) f['Received Date']    = data.receivedDate;
  if (data.serialImei      !== undefined) f['Serial Number / IMEI'] = data.serialImei;
  if (data.color           !== undefined) f['Color']            = data.color;
  if (data.storageRam      !== undefined) f['Storage / RAM']    = data.storageRam;
  if (data.location        !== undefined) f['Warehouse / Location'] = data.location;
  if (data.custodian       !== undefined) f['Custodian']        = data.custodian;
  if (data.purpose         !== undefined) f['Purpose / Test Type'] = data.purpose;
  if (data.remarks         !== undefined) f['Remarks']          = data.remarks;
  return f;
}

async function listDevices({ brand, category, pageSize = 50, pageToken } = {}) {
  const filters = [];
  if (brand)    filters.push(`CurrentValue.[Competitor Brand] = "${brand}"`);
  if (category) filters.push(`CurrentValue.[Category] = "${category}"`);
  const filter = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];
  const result = await listPage(TABLES.BENCHMARK(), { filter, pageSize, pageToken });
  return { ...result, items: result.items.map(toDevice) };
}

async function createDevice(data, actorUser) {
  const record = await createOne(TABLES.BENCHMARK(), toFields(data));
  await audit.log({ ...actorUser, action: AUDIT_ACTIONS.UPLOAD, entityType: 'Benchmark', entityId: record.record_id, newValue: data });
  return toDevice(record);
}

async function bulkUpload(fileBuffer, actorUser) {
  const batchId  = `BENCH-${Date.now()}`;
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  // Try "Benchmark Upload" sheet first, then first sheet
  const sheetName = workbook.SheetNames.includes('Benchmark Upload')
    ? 'Benchmark Upload' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const summary = { batchId, total: rows.length, success: 0, failed: 0, errors: [] };
  const toInsert = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const brand = String(row['Competitor Brand'] || row['Brand'] || '').trim();
    const model = String(row['Device Model'] || '').trim();
    if (!brand || !model) {
      summary.failed++;
      summary.errors.push({ row: i + 2, reason: 'Missing Competitor Brand or Device Model' });
      continue;
    }
    toInsert.push({
      competitorBrand: brand,
      deviceModel:     model,
      category:        String(row['Category'] || '').trim(),
      source:          String(row['Source'] || '').trim(),
      serialImei:      String(row['Serial Number / IMEI'] || '').trim(),
      color:           String(row['Color'] || '').trim(),
      storageRam:      String(row['Storage / RAM'] || '').trim(),
      location:        String(row['Warehouse / Location'] || '').trim(),
      custodian:       String(row['Custodian'] || '').trim(),
      purpose:         String(row['Purpose / Test Type'] || '').trim(),
      remarks:         String(row['Remarks'] || '').trim(),
    });
  }

  if (toInsert.length) {
    const inserted = await batchCreate(TABLES.BENCHMARK(), toInsert.map(toFields));
    summary.success = inserted.length;
    await audit.log({ ...actorUser, action: AUDIT_ACTIONS.UPLOAD, entityType: 'Benchmark', entityId: batchId, newValue: { count: inserted.length } });
  }
  summary.failed = rows.length - summary.success;
  return summary;
}

async function getStats() {
  const all = await listAll(TABLES.BENCHMARK());
  const devices = all.map(toDevice);
  const byBrand = {};
  const byCategory = {};
  devices.forEach(d => {
    byBrand[d.competitorBrand]    = (byBrand[d.competitorBrand]    || 0) + 1;
    byCategory[d.category || 'Unknown'] = (byCategory[d.category || 'Unknown'] || 0) + 1;
  });
  return { total: devices.length, byBrand, byCategory };
}

module.exports = { listDevices, createDevice, bulkUpload, getStats };
