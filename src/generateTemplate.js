// src/generateTemplate.js
// Run: node src/generateTemplate.js
// Generates the Excel bulk-upload template for inventory holders.

const XLSX = require('xlsx');
const path = require('path');

const HEADERS = [
  'Brand',
  'Device Model',
  'Sample / HW Type',
  'HW Stage',
  'Sample Received Date',
  'VC ID',
  'IMEI1',
  'IMEI2',
  'Color',
  'Storage / RAM Variant',
  'Warehouse / Location',
  'Inventory Holder',
  'Remarks',
];

const SAMPLE_ROWS = [
  ['Samsung',  'Galaxy S25', 'Phone',   'DVT', '2025-01-15', 'VC-10001', '352000001234567', '352000001234568', 'Black',  '12GB/256GB', 'WH-A',   'John Smith',  ''],
  ['Apple',    'iPhone 17',  'Phone',   'EVT', '2025-02-01', 'VC-10002', '352000009876543', '352000009876544', 'White',  '8GB/512GB',  'WH-B',   'Jane Doe',    'Priority sample'],
  ['OnePlus',  'Nord 5',     'Phone',   'PVT', '2025-03-10', 'VC-10003', '352000005551234', '',               'Green',  '8GB/128GB',  'WH-A',   'Raj Kumar',   ''],
];

const wb = XLSX.utils.book_new();

// Main data sheet
const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...SAMPLE_ROWS]);

// Column widths
ws['!cols'] = HEADERS.map(h => ({ wch: Math.max(h.length + 4, 18) }));

// Header style (bold)
const range = XLSX.utils.decode_range(ws['!ref']);
for (let col = range.s.c; col <= range.e.c; col++) {
  const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
  if (ws[cellAddress]) {
    ws[cellAddress].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9EAD3' } } };
  }
}

// Instructions sheet
const instructions = [
  ['BULK UPLOAD TEMPLATE — Device Sample Inventory'],
  [''],
  ['MANDATORY FIELDS (must not be empty):'],
  ['Brand, Device Model, Sample / HW Type, HW Stage, IMEI1, Color, Storage / RAM Variant, Warehouse / Location, Inventory Holder'],
  [''],
  ['OPTIONAL FIELDS:'],
  ['Sample Received Date, VC ID, IMEI2, Remarks'],
  [''],
  ['HW STAGE values: EVT | DVT | PVT | MP | Other'],
  ['IMEI format: 15 digits, e.g. 352000001234567'],
  ['Date format: YYYY-MM-DD, e.g. 2025-01-15'],
  [''],
  ['DUPLICATE DETECTION:'],
  ['System blocks records where IMEI1, IMEI2, or VC ID already exists in the database.'],
  ['Duplicate rows are logged and Admin is notified via email.'],
  [''],
  ['UPLOAD SUMMARY returned after upload:'],
  ['• Total Uploaded • Successful Entries • Failed Entries • Duplicate Entries • Missing Data Records'],
];

const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
wsInstructions['!cols'] = [{ wch: 80 }];

XLSX.utils.book_append_sheet(wb, ws, 'Inventory Upload');
XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

const outPath = path.join(__dirname, '..', 'inventory_bulk_upload_template.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✅  Template saved: ${outPath}`);
