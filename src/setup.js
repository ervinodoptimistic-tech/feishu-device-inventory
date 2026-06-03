// src/setup.js  —  Run ONCE: npm run setup
// Creates all 10 Bitable tables with complete field schemas.

require('dotenv').config();
const client = require('../config/feishu');
const { DEVICE_STATUS, REQUEST_STATUS } = require('../config/constants');

const SCHEMAS = {
  Inventory: [
    { field_name: 'Inventory ID',          type: 1005 },
    { field_name: 'Brand',                 type: 3, property: { options: [
      { name: 'itel' }, { name: 'Tecno' }, { name: 'Infinix' }, { name: 'Oraimo' }, { name: 'Villaon' }, { name: 'Other' }
    ]}},
    { field_name: 'Device Model',          type: 1 },
    { field_name: 'Sample / HW Type',      type: 3, property: { options: [
      { name: 'PR0' }, { name: 'PR0-1' }, { name: 'PR1' }, { name: 'PR1-1' }, { name: 'PR2' }, { name: 'PIR' }, { name: 'MPR' }
    ]}},
    { field_name: 'HW Stage',              type: 3, property: { options: [
      { name: 'EVT' }, { name: 'DVT' }, { name: 'PVT' }, { name: 'MP' }, { name: 'Other' }
    ]}},
    { field_name: 'IMEI1',                 type: 1 },
    { field_name: 'IMEI2',                 type: 1 },
    { field_name: 'VC ID',                 type: 1 },
    { field_name: 'Color',                 type: 1 },
    { field_name: 'Storage / RAM Variant', type: 1 },
    { field_name: 'Sample Received Date',  type: 5 },
    { field_name: 'Warehouse / Location',  type: 1 },
    { field_name: 'Inventory Holder',      type: 1 },
    { field_name: 'Device Status',         type: 3, property: { options:
      Object.values(DEVICE_STATUS).map(s => ({ name: s }))
    }},
    { field_name: 'Assigned To',           type: 1 },
    { field_name: 'Employee ID',           type: 1 },
    { field_name: 'Assigned Date',         type: 5 },
    { field_name: 'Expected Return Date',  type: 5 },
    { field_name: 'Actual Return Date',    type: 5 },
    { field_name: 'Condition on Return',   type: 1 },
    { field_name: 'Upload Batch ID',       type: 1 },
    { field_name: 'Remarks',               type: 1 },
    { field_name: 'Images',                type: 17 },   // Attachment
    { field_name: 'Created At',            type: 1001 },
    { field_name: 'Last Modified At',      type: 1002 },
  ],

  Users: [
    { field_name: 'Employee ID',    type: 1 },
    { field_name: 'Full Name',      type: 1 },
    { field_name: 'Email',          type: 1 },
    { field_name: 'Password Hash',  type: 1 },
    { field_name: 'Role',           type: 3, property: { options: [
      { name: 'Admin' }, { name: 'TL' }, { name: 'InventoryHolder' },
      { name: 'Employee' }, { name: 'BenchmarkViewer' }
    ]}},
    { field_name: 'Department',      type: 1 },
    { field_name: 'TL Employee ID',  type: 1 },
    { field_name: 'Is Active',       type: 7 },
    { field_name: 'Created At',      type: 1001 },
  ],

  Requests: [
    { field_name: 'Request ID',            type: 1005 },
    { field_name: 'Employee Name',         type: 1 },
    { field_name: 'Employee ID',           type: 1 },
    { field_name: 'Department',            type: 1 },
    { field_name: 'Project Name',          type: 1 },
    { field_name: 'Purpose',               type: 1 },
    { field_name: 'Duration Required',     type: 1 },
    { field_name: 'Preferred Brand',       type: 1 },
    { field_name: 'Preferred Model',       type: 1 },
    { field_name: 'Priority',              type: 3, property: { options: [
      { name: 'Low' }, { name: 'Medium' }, { name: 'High' }, { name: 'Critical' }
    ]}},
    { field_name: 'Request Status',        type: 3, property: { options:
      Object.values(REQUEST_STATUS).map(s => ({ name: s }))
    }},
    { field_name: 'TL Employee ID',        type: 1 },
    { field_name: 'TL Decision',           type: 1 },
    { field_name: 'TL Remarks',            type: 1 },
    { field_name: 'TL Decision Date',      type: 5 },
    { field_name: 'Assigned Inventory ID', type: 1 },
    { field_name: 'Remarks',               type: 1 },
    { field_name: 'Requested At',          type: 1001 },
    { field_name: 'Updated At',            type: 1002 },
  ],

  Assignments: [
    { field_name: 'Assignment ID',         type: 1005 },
    { field_name: 'Inventory Record ID',   type: 1 },
    { field_name: 'IMEI1',                 type: 1 },
    { field_name: 'Brand',                 type: 1 },
    { field_name: 'Device Model',          type: 1 },
    { field_name: 'Employee Name',         type: 1 },
    { field_name: 'Employee ID',           type: 1 },
    { field_name: 'Request ID',            type: 1 },
    { field_name: 'Assigned By',           type: 1 },
    { field_name: 'Assigned Date',         type: 5 },
    { field_name: 'Expected Return Date',  type: 5 },
    { field_name: 'Status',                type: 3, property: { options: [
      { name: 'Active' }, { name: 'Returned' }, { name: 'Overdue' }
    ]}},
    { field_name: 'Remarks',               type: 1 },
    { field_name: 'Created At',            type: 1001 },
  ],

  Returns: [
    { field_name: 'Return ID',             type: 1005 },
    { field_name: 'Assignment Record ID',  type: 1 },
    { field_name: 'Inventory Record ID',   type: 1 },
    { field_name: 'IMEI1',                 type: 1 },
    { field_name: 'Brand',                 type: 1 },
    { field_name: 'Device Model',          type: 1 },
    { field_name: 'Returned By',           type: 1 },
    { field_name: 'Employee ID',           type: 1 },
    { field_name: 'Return Date',           type: 5 },
    { field_name: 'Physical Condition',    type: 3, property: { options: [
      { name: 'Good' }, { name: 'Minor Damage' }, { name: 'Major Damage' }, { name: 'Non-Functional' }
    ]}},
    { field_name: 'Accessories Present',   type: 7 },
    { field_name: 'Validated By',          type: 1 },
    { field_name: 'Condition Remarks',     type: 1 },
    { field_name: 'Return Images',         type: 17 },  // Attachment — photos on return
    { field_name: 'New Status',            type: 1 },
    { field_name: 'Created At',            type: 1001 },
  ],

  AuditLog: [
    { field_name: 'Log ID',         type: 1005 },
    { field_name: 'User ID',        type: 1 },
    { field_name: 'User Name',      type: 1 },
    { field_name: 'User Role',      type: 1 },
    { field_name: 'Action Type',    type: 3, property: { options: [
      { name: 'Upload' }, { name: 'Assignment' }, { name: 'Return' }, { name: 'Reallocation' },
      { name: 'RequestCreated' }, { name: 'RequestApproved' }, { name: 'RequestRejected' },
      { name: 'Amendment' }, { name: 'DuplicateBlocked' }, { name: 'StatusChange' }, { name: 'Login' }, { name: 'ImageUpload' },
    ]}},
    { field_name: 'Entity Type',    type: 1 },
    { field_name: 'Entity ID',      type: 1 },
    { field_name: 'Previous Value', type: 1 },
    { field_name: 'Updated Value',  type: 1 },
    { field_name: 'IP Address',     type: 1 },
    { field_name: 'Timestamp',      type: 1001 },
  ],

  DuplicateLog: [
    { field_name: 'Dup Log ID',       type: 1005 },
    { field_name: 'Upload Batch ID',  type: 1 },
    { field_name: 'Field Name',       type: 1 },
    { field_name: 'Duplicate Value',  type: 1 },
    { field_name: 'Row Data',         type: 1 },
    { field_name: 'Blocked By',       type: 1 },
    { field_name: 'Reason',           type: 1 },
    { field_name: 'Timestamp',        type: 1001 },
  ],

  Amendments: [
    { field_name: 'Amendment ID',    type: 1005 },
    { field_name: 'Table Name',      type: 1 },
    { field_name: 'Record ID',       type: 1 },
    { field_name: 'Field Name',      type: 1 },
    { field_name: 'Original Value',  type: 1 },
    { field_name: 'Requested Value', type: 1 },
    { field_name: 'Justification',   type: 1 },
    { field_name: 'Requested By',    type: 1 },
    { field_name: 'Requester ID',    type: 1 },
    { field_name: 'Status',          type: 3, property: { options: [
      { name: 'Pending' }, { name: 'Approved' }, { name: 'Rejected' }
    ]}},
    { field_name: 'Reviewed By',     type: 1 },
    { field_name: 'Review Remarks',  type: 1 },
    { field_name: 'Applied At',      type: 5 },
    { field_name: 'Created At',      type: 1001 },
  ],

  Notifications: [
    { field_name: 'Notif ID',     type: 1005 },
    { field_name: 'Recipient ID', type: 1 },
    { field_name: 'Email',        type: 1 },
    { field_name: 'Type',         type: 1 },
    { field_name: 'Subject',      type: 1 },
    { field_name: 'Body',         type: 1 },
    { field_name: 'Is Read',      type: 7 },
    { field_name: 'Sent At',      type: 1001 },
  ],

  Benchmark: [
    { field_name: 'Competitor Brand',      type: 1 },
    { field_name: 'Device Model',          type: 1 },
    { field_name: 'Category',              type: 3, property: { options: [
      { name: 'Smartphone' }, { name: 'Tablet' }, { name: 'Wearable' },
      { name: 'TWS' }, { name: 'Feature Phone' }, { name: 'Other' }
    ]}},
    { field_name: 'Source',                type: 1 },
    { field_name: 'Received Date',         type: 5 },
    { field_name: 'Serial Number / IMEI',  type: 1 },
    { field_name: 'Color',                 type: 1 },
    { field_name: 'Storage / RAM',         type: 1 },
    { field_name: 'Warehouse / Location',  type: 1 },
    { field_name: 'Custodian',             type: 1 },
    { field_name: 'Purpose / Test Type',   type: 1 },
    { field_name: 'Remarks',               type: 1 },
    { field_name: 'Images',                type: 17 },  // Attachment
    { field_name: 'Created At',            type: 1001 },
  ],
};

async function createTableFields(appToken, tableId, fields) {
  for (const field of fields) {
    try {
      await client.bitable.appTableField.create({
        path: { app_token: appToken, table_id: tableId },
        data: field,
      });
      process.stdout.write('.');
    } catch (_) { process.stdout.write('~'); }
  }
}

async function setup() {
  console.log('\n🚀  Device Inventory System v2 — Feishu Bitable Setup\n');

  console.log('📋  Creating Bitable app...');
  const appRes = await client.bitable.app.create({
    data: { name: 'Device Sample Inventory System v2', time_zone: 'Asia/Shanghai' },
  });
  if (!appRes.data?.app?.app_token) { console.error('❌  Failed'); process.exit(1); }
  const appToken = appRes.data.app.app_token;
  console.log(`✅  app_token: ${appToken}`);

  const tablesRes = await client.bitable.appTable.list({ path: { app_token: appToken } });
  const defaultTableId = tablesRes.data?.items?.[0]?.table_id;
  const tableIds = {};
  const tableNames = Object.keys(SCHEMAS);

  for (let i = 0; i < tableNames.length; i++) {
    const name = tableNames[i];
    let tableId;
    if (i === 0) {
      await client.bitable.appTable.patch({ path: { app_token: appToken, table_id: defaultTableId }, data: { name } });
      tableId = defaultTableId;
      console.log(`\n✅  Renamed default → ${name} (${tableId})`);
    } else {
      const res = await client.bitable.appTable.create({ path: { app_token: appToken }, data: { table: { name } } });
      tableId = res.data?.table_id;
      if (!tableId) { console.error(`❌  Failed: ${name}`); process.exit(1); }
      console.log(`✅  Created: ${name} (${tableId})`);
    }
    tableIds[name] = tableId;
    process.stdout.write(`   Fields for ${name}: `);
    await createTableFields(appToken, tableId, SCHEMAS[name]);
    console.log(' done');
  }

  const line = '═'.repeat(62);
  console.log(`\n${line}`);
  console.log('🎉  All 10 tables created! Add to your .env:\n');
  console.log(`BITABLE_APP_TOKEN=${appToken}`);
  console.log(`TABLE_INVENTORY=${tableIds['Inventory']}`);
  console.log(`TABLE_USERS=${tableIds['Users']}`);
  console.log(`TABLE_REQUESTS=${tableIds['Requests']}`);
  console.log(`TABLE_ASSIGNMENTS=${tableIds['Assignments']}`);
  console.log(`TABLE_RETURNS=${tableIds['Returns']}`);
  console.log(`TABLE_AUDIT_LOG=${tableIds['AuditLog']}`);
  console.log(`TABLE_DUPLICATE_LOG=${tableIds['DuplicateLog']}`);
  console.log(`TABLE_AMENDMENTS=${tableIds['Amendments']}`);
  console.log(`TABLE_NOTIFICATIONS=${tableIds['Notifications']}`);
  console.log(`TABLE_BENCHMARK=${tableIds['Benchmark']}`);
  console.log(`\nThen run:  npm run dev\n${line}\n`);
}

setup().catch(err => { console.error('\n❌', err.message || err); process.exit(1); });
