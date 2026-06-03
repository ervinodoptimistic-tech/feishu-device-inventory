// services/reportService.js
// Generates downloadable reports in Excel/CSV.
// PDF generation can be added with puppeteer or pdfkit.

const XLSX = require('xlsx');
const { listAll, fieldText, selectText } = require('../utils/bitable');
const { TABLES, DEVICE_STATUS } = require('../config/constants');
const invSvc = require('./inventoryService');

// ── Helper: convert array of objects to XLSX buffer ──────────────────────────
function toXlsx(rows, sheetName = 'Report') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines   = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = String(row[h] ?? '').replace(/"/g, '""');
      return v.includes(',') || v.includes('"') ? `"${v}"` : v;
    }).join(','));
  }
  return lines.join('\n');
}

// ── Report generators ─────────────────────────────────────────────────────────

async function inventoryOverviewReport() {
  const all = await listAll(TABLES.INVENTORY());
  return all.map(r => {
    const f = r.fields || {};
    return {
      'Inventory ID':        fieldText(f['Inventory ID']),
      'Brand':               fieldText(f['Brand']),
      'Device Model':        fieldText(f['Device Model']),
      'IMEI1':               fieldText(f['IMEI1']),
      'IMEI2':               fieldText(f['IMEI2']),
      'VC ID':               fieldText(f['VC ID']),
      'HW Stage':            selectText(f['HW Stage']),
      'Color':               fieldText(f['Color']),
      'Storage/RAM':         fieldText(f['Storage / RAM Variant']),
      'Warehouse':           fieldText(f['Warehouse / Location']),
      'Status':              selectText(f['Device Status']),
      'Assigned To':         fieldText(f['Assigned To']),
      'Employee ID':         fieldText(f['Employee ID']),
      'Assigned Date':       f['Assigned Date'] ? new Date(f['Assigned Date']).toLocaleDateString() : '',
      'Expected Return':     f['Expected Return Date'] ? new Date(f['Expected Return Date']).toLocaleDateString() : '',
      'Remarks':             fieldText(f['Remarks']),
    };
  });
}

async function employeeAllocationReport() {
  const all = await listAll(TABLES.ASSIGNMENTS());
  return all.map(r => {
    const f = r.fields || {};
    return {
      'Assignment ID':      fieldText(f['Assignment ID']),
      'Employee Name':      fieldText(f['Employee Name']),
      'Employee ID':        fieldText(f['Employee ID']),
      'Brand':              fieldText(f['Brand']),
      'Device Model':       fieldText(f['Device Model']),
      'IMEI1':              fieldText(f['IMEI1']),
      'Assigned Date':      f['Assigned Date'] ? new Date(f['Assigned Date']).toLocaleDateString() : '',
      'Expected Return':    f['Expected Return Date'] ? new Date(f['Expected Return Date']).toLocaleDateString() : '',
      'Status':             selectText(f['Status']),
      'Assigned By':        fieldText(f['Assigned By']),
    };
  });
}

async function overdueDevicesReport() {
  const now = Date.now();
  const all = await listAll(TABLES.ASSIGNMENTS());
  return all
    .filter(r => {
      const status = selectText(r.fields?.['Status']);
      const due    = r.fields?.['Expected Return Date'];
      return status === 'Active' && due && due < now;
    })
    .map(r => {
      const f = r.fields || {};
      const due = f['Expected Return Date'];
      const daysOverdue = Math.floor((now - due) / 86400000);
      return {
        'Employee Name':    fieldText(f['Employee Name']),
        'Employee ID':      fieldText(f['Employee ID']),
        'Brand':            fieldText(f['Brand']),
        'Device Model':     fieldText(f['Device Model']),
        'IMEI1':            fieldText(f['IMEI1']),
        'Expected Return':  due ? new Date(due).toLocaleDateString() : '',
        'Days Overdue':     daysOverdue,
        'Assigned By':      fieldText(f['Assigned By']),
      };
    });
}

async function duplicateLogsReport() {
  const all = await listAll(TABLES.DUPLICATE_LOG());
  return all.map(r => {
    const f = r.fields || {};
    return {
      'Upload Batch ID':  fieldText(f['Upload Batch ID']),
      'Field Name':       fieldText(f['Field Name']),
      'Duplicate Value':  fieldText(f['Duplicate Value']),
      'Row Data':         fieldText(f['Row Data']),
      'Blocked By':       fieldText(f['Blocked By']),
      'Reason':           fieldText(f['Reason']),
    };
  });
}

async function damagedDevicesReport() {
  const all = await listAll(TABLES.INVENTORY());
  return all
    .filter(r => {
      const s = selectText(r.fields?.['Device Status']);
      return s === DEVICE_STATUS.DAMAGED || s === DEVICE_STATUS.SCRAPPED;
    })
    .map(r => {
      const f = r.fields || {};
      return {
        'Brand':            fieldText(f['Brand']),
        'Device Model':     fieldText(f['Device Model']),
        'IMEI1':            fieldText(f['IMEI1']),
        'Status':           selectText(f['Device Status']),
        'Last Assigned To': fieldText(f['Assigned To']),
        'Condition Remarks':fieldText(f['Condition on Return']),
        'Warehouse':        fieldText(f['Warehouse / Location']),
      };
    });
}

async function auditLogReport({ startDate, endDate } = {}) {
  const all = await listAll(TABLES.AUDIT_LOG());
  return all
    .filter(r => {
      const ts = r.fields?.['Timestamp'];
      if (startDate && ts < new Date(startDate).getTime()) return false;
      if (endDate   && ts > new Date(endDate).getTime())   return false;
      return true;
    })
    .map(r => {
      const f = r.fields || {};
      return {
        'User ID':       fieldText(f['User ID']),
        'User Name':     fieldText(f['User Name']),
        'Role':          fieldText(f['User Role']),
        'Action':        selectText(f['Action Type']),
        'Entity Type':   fieldText(f['Entity Type']),
        'Entity ID':     fieldText(f['Entity ID']),
        'Previous Value':fieldText(f['Previous Value']),
        'Updated Value': fieldText(f['Updated Value']),
      };
    });
}

// ── Export dispatcher ─────────────────────────────────────────────────────────

const REPORT_GENERATORS = {
  inventory:          inventoryOverviewReport,
  employee_allocation:employeeAllocationReport,
  overdue:            overdueDevicesReport,
  duplicate_logs:     duplicateLogsReport,
  damaged:            damagedDevicesReport,
  audit_log:          auditLogReport,
};

async function exportReport(reportType, format = 'xlsx', opts = {}) {
  const generator = REPORT_GENERATORS[reportType];
  if (!generator) throw new Error(`Unknown report type: ${reportType}. Valid: ${Object.keys(REPORT_GENERATORS).join(', ')}`);

  const rows = await generator(opts);

  if (format === 'csv') {
    return { data: toCsv(rows), contentType: 'text/csv', filename: `${reportType}_${Date.now()}.csv` };
  }
  // Default: xlsx
  return { data: toXlsx(rows, reportType), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${reportType}_${Date.now()}.xlsx` };
}

module.exports = { exportReport, REPORT_GENERATORS };
