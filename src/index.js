// src/index.js  —  Device Sample Inventory Management System
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const morgan       = require('morgan');
const routes       = require('../routes/index');
const errorHandler = require('../middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  service: 'Device Sample Inventory System',
  timestamp: new Date().toISOString(),
  bitable: {
    appToken:  process.env.BITABLE_APP_TOKEN  ? '✅' : '❌ missing',
    inventory: process.env.TABLE_INVENTORY    ? '✅' : '❌ missing',
    users:     process.env.TABLE_USERS        ? '✅' : '❌ missing',
    requests:  process.env.TABLE_REQUESTS     ? '✅' : '❌ missing',
  },
}));

// ── API ────────────────────────────────────────────────────────────────────────
app.use(express.static('public'));
app.use('/api', routes);

// 404
app.use((req, res) => res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.path}` }));

app.use(errorHandler);

app.listen(PORT, () => {
  const line = '═'.repeat(50);
  console.log(`\n${line}`);
  console.log('  Device Sample Inventory Management System');
  console.log(`  Feishu Bitable + Node.js + Express`);
  console.log(line);
  console.log(`\n🚀  http://localhost:${PORT}`);
  console.log('\nAPI Endpoints:');
  const eps = [
    'POST   /api/auth/register',
    'POST   /api/auth/login',
    'GET    /api/auth/me',
    '─── Inventory ───',
    'GET    /api/inventory',
    'GET    /api/inventory/dashboard',
    'POST   /api/inventory',
    'POST   /api/inventory/bulk-upload     (multipart file)',
    'PATCH  /api/inventory/:id/status',
    '─── Requests ───',
    'GET    /api/requests',
    'POST   /api/requests',
    'POST   /api/requests/:id/approve',
    'POST   /api/requests/:id/reject',
    'POST   /api/requests/:id/clarify',
    '─── Returns ───',
    'GET    /api/returns',
    'POST   /api/returns',
    'POST   /api/returns/:id/validate',
    '─── Amendments ───',
    'GET    /api/amendments',
    'POST   /api/amendments',
    'POST   /api/amendments/:id/approve',
    '─── Reports ───',
    'GET    /api/reports/:type?format=xlsx|csv',
    '       Types: inventory | employee_allocation | overdue',
    '              duplicate_logs | damaged | audit_log',
    '─── Audit ───',
    'GET    /api/audit-log',
    'GET    /api/duplicate-log',
    'GET    /api/notifications',
  ];
  eps.forEach(e => console.log(`  ${e}`));
  console.log(`\n${line}\n`);
});
