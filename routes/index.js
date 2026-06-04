// routes/index.js  —  Master router
const { Router } = require('express');
const multer     = require('multer');
const { body, param, validationResult } = require('express-validator');
const { authenticate, authorize, adminOnly, adminOrTL, adminOrHolder, allStaff } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const invSvc     = require('../services/inventoryService');
const usrSvc     = require('../services/userService');
const reqSvc     = require('../services/requestService');
const retSvc     = require('../services/returnService');
const amdSvc     = require('../services/amendmentService');
const rptSvc     = require('../services/reportService');
const { listAll, listPage, fieldText, selectText } = require('../utils/bitable');
const { TABLES } = require('../config/constants');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const validate = rules => [...rules, (req, res, next) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ success: false, errors: errs.array() });
  next();
}];

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/register  (Admin only after first user)
router.post('/auth/register', validate([
  body('employeeId').notEmpty(),
  body('fullName').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 8 }),
  body('role').isIn(Object.values(ROLES)),
]), async (req, res, next) => {
  try {
    const user = await usrSvc.register(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/auth/login', validate([
  body('employeeId').notEmpty(),
  body('password').notEmpty(),
]), async (req, res, next) => {
  try {
    const result = await usrSvc.login(req.body.employeeId, req.body.password);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// GET /api/users  (Admin only)
router.get('/users', authenticate, adminOnly, async (req, res, next) => {
  try {
    const users = await usrSvc.listUsers();
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// PATCH /api/users/:recordId/profile  (Admin — edit role/dept/TL)
router.patch('/users/:recordId/profile', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { role, department, tlEmployeeId } = req.body;
    const { updateOne } = require('../utils/bitable');
    const fields = {};
    if (role)         fields['Role']           = role;
    if (department !== undefined) fields['Department'] = department;
    if (tlEmployeeId !== undefined) fields['TL Employee ID'] = tlEmployeeId;
    await updateOne(TABLES.USERS(), req.params.recordId, fields);
    const { log } = require('../services/auditService');
    await log({ ...req.user, action: 'StatusChange', entityType: 'User', entityId: req.params.recordId, newValue: { role, department } });
    res.json({ success: true, message: 'User updated' });
  } catch (err) { next(err); }
});

// PATCH /api/users/:recordId/status  (Admin — activate/deactivate)
router.patch('/users/:recordId/status', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const { updateOne } = require('../utils/bitable');
    await updateOne(TABLES.USERS(), req.params.recordId, { 'Is Active': Boolean(isActive) });
    const { log } = require('../services/auditService');
    await log({ ...req.user, action: 'StatusChange', entityType: 'User', entityId: req.params.recordId, newValue: { isActive } });
    res.json({ success: true, message: `User ${isActive ? 'activated' : 'deactivated'}` });
  } catch (err) { next(err); }
});

// PATCH /api/users/:employeeId/email  (Admin only)
router.patch('/users/:employeeId/email', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { email } = req.body;
    const userRecord = await usrSvc.findUserRecord(req.params.employeeId);
    if (!userRecord) return res.status(404).json({ success: false, message: 'User not found' });
    const { updateOne } = require('../utils/bitable');
    await updateOne(TABLES.USERS(), userRecord._recordId, { 'Email': email });
    res.json({ success: true, message: 'Email updated', employeeId: req.params.employeeId, email });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════════════════════════

// GET /api/inventory — employees only see their own, others see all
router.get('/inventory', authenticate, allStaff, async (req, res, next) => {
  try {
    const { status, brand, location, hwStage, pageSize, pageToken } = req.query;
    // Employees restricted to their own devices
    const assignedTo = req.user.role === ROLES.EMPLOYEE ? req.user.employeeId : req.query.assignedTo;
    const result = await invSvc.listDevices({ status, brand, location, hwStage, assignedTo, pageSize: Number(pageSize) || 50, pageToken });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/inventory/dashboard
router.get('/inventory/dashboard', authenticate, adminOrHolder, async (req, res, next) => {
  try {
    const stats = await invSvc.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// GET /api/inventory/:id
router.get('/inventory/:id', authenticate, allStaff, async (req, res, next) => {
  try {
    const device = await invSvc.getDevice(req.params.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    // Employee can only see their own
    if (req.user.role === ROLES.EMPLOYEE && device.employeeId !== req.user.employeeId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

// POST /api/inventory  (Admin/InventoryHolder)
router.post('/inventory', authenticate, adminOrHolder, validate([
  body('brand').notEmpty(),
  body('deviceModel').notEmpty(),
  body('imei1').notEmpty(),
]), async (req, res, next) => {
  try {
    const result = await invSvc.createDevice(req.body, req.user);
    if (!result.success) {
      return res.status(409).json({ success: false, message: 'Duplicate detected', duplicates: result.duplicates });
    }
    res.status(201).json({ success: true, data: result.device });
  } catch (err) { next(err); }
});

// POST /api/inventory/bulk-upload — streaming SSE progress for large files
router.post('/inventory/bulk-upload', authenticate, adminOrHolder, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded. Field name: file' });

    // Use SSE to stream progress back to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    const adminUsers = await usrSvc.listUsers();
    const admin = adminUsers.find(u => u.role === ROLES.ADMIN);

    try {
      const summary = await invSvc.bulkUpload(
        req.file.buffer,
        req.user,
        admin?.email,
        (msg) => send('progress', { message: msg })
      );
      send('complete', { success: true, summary });
    } catch (err) {
      send('error', { success: false, message: err.message });
    }
    res.end();
  } catch (err) { next(err); }
});

// PATCH /api/inventory/:id/status  (Admin/InventoryHolder)
router.patch('/inventory/:id/status', authenticate, adminOrHolder, validate([
  body('deviceStatus').notEmpty(),
]), async (req, res, next) => {
  try {
    const device = await invSvc.updateDevice(req.params.id, req.body, req.user);
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// DEVICE REQUESTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/requests
router.get('/requests', authenticate, allStaff, async (req, res, next) => {
  try {
    const { status, pageSize, pageToken } = req.query;
    // Employee sees only their own requests
    const employeeId = req.user.role === ROLES.EMPLOYEE ? req.user.employeeId : req.query.employeeId;
    const result = await reqSvc.listRequests({ employeeId, status, pageSize: Number(pageSize) || 50, pageToken });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/requests  (Any authenticated employee)
router.post('/requests', authenticate, allStaff, validate([
  body('purpose').notEmpty(),
  body('durationRequired').notEmpty(),
]), async (req, res, next) => {
  try {
    const req_ = await reqSvc.submitRequest(req.body, req.user);
    res.status(201).json({ success: true, data: req_ });
  } catch (err) { next(err); }
});

// POST /api/requests/:id/approve  (TL/Admin)
router.post('/requests/:id/approve', authenticate, adminOrTL, validate([
  body('inventoryRecordId').notEmpty().withMessage('inventoryRecordId is required'),
  body('expectedReturnDate').notEmpty(),
]), async (req, res, next) => {
  try {
    const result = await reqSvc.approveRequest(req.params.id, req.body, req.user);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/requests/:id/reject  (TL/Admin)
router.post('/requests/:id/reject', authenticate, adminOrTL, async (req, res, next) => {
  try {
    await reqSvc.rejectRequest(req.params.id, req.body, req.user);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/requests/:id/clarify  (TL/Admin)
router.post('/requests/:id/clarify', authenticate, adminOrTL, async (req, res, next) => {
  try {
    await reqSvc.requestClarification(req.params.id, req.body, req.user);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// RETURNS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/returns
router.get('/returns', authenticate, allStaff, async (req, res, next) => {
  try {
    const employeeId = req.user.role === ROLES.EMPLOYEE ? req.user.employeeId : req.query.employeeId;
    const result = await retSvc.listReturns({ employeeId, pageSize: Number(req.query.pageSize) || 50, pageToken: req.query.pageToken });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/returns  (Employee submits return)
router.post('/returns', authenticate, allStaff, validate([
  body('inventoryRecordId').notEmpty(),
  body('physicalCondition').isIn(['Good','Minor Damage','Major Damage','Non-Functional']),
]), async (req, res, next) => {
  try {
    const returnRec = await retSvc.submitReturn(req.body, req.user);
    res.status(201).json({ success: true, data: returnRec });
  } catch (err) { next(err); }
});

// POST /api/returns/:id/validate  (InventoryHolder validates)
router.post('/returns/:id/validate', authenticate, adminOrHolder, async (req, res, next) => {
  try {
    const result = await retSvc.validateReturn(req.params.id, req.body, req.user);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// AMENDMENTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/amendments
router.get('/amendments', authenticate, adminOnly, async (req, res, next) => {
  try {
    const result = await amdSvc.listAmendments(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/amendments  (Any staff can request)
router.post('/amendments', authenticate, allStaff, validate([
  body('tableName').notEmpty(),
  body('recordId').notEmpty(),
  body('fieldName').notEmpty(),
  body('requestedValue').notEmpty(),
  body('justification').notEmpty().withMessage('Justification is mandatory for amendments'),
]), async (req, res, next) => {
  try {
    const amd = await amdSvc.requestAmendment(req.body, req.user);
    res.status(201).json({ success: true, data: amd });
  } catch (err) { next(err); }
});

// POST /api/amendments/:id/approve  (Admin only)
router.post('/amendments/:id/approve', authenticate, adminOnly, async (req, res, next) => {
  try {
    await amdSvc.approveAmendment(req.params.id, req.body, req.user);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/amendments/:id/reject  (Admin only)
router.post('/amendments/:id/reject', authenticate, adminOnly, async (req, res, next) => {
  try {
    await amdSvc.rejectAmendment(req.params.id, req.body, req.user);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════════════════

// GET /api/audit-log  (Admin/TL)
router.get('/audit-log', authenticate, adminOrTL, async (req, res, next) => {
  try {
    const result = await listPage(TABLES.AUDIT_LOG(), { pageSize: Number(req.query.pageSize) || 50, pageToken: req.query.pageToken });
    const items = result.items.map(r => ({
      logId:       fieldText(r.fields?.['Log ID']),
      userId:      fieldText(r.fields?.['User ID']),
      userName:    fieldText(r.fields?.['User Name']),
      userRole:    fieldText(r.fields?.['User Role']),
      action:      selectText(r.fields?.['Action Type']),
      entityType:  fieldText(r.fields?.['Entity Type']),
      entityId:    fieldText(r.fields?.['Entity ID']),
      prevValue:   fieldText(r.fields?.['Previous Value']),
      newValue:    fieldText(r.fields?.['Updated Value']),
      timestamp:   r.fields?.['Timestamp'],
    }));
    res.json({ success: true, ...result, items });
  } catch (err) { next(err); }
});

// GET /api/duplicate-log  (Admin)
router.get('/duplicate-log', authenticate, adminOnly, async (req, res, next) => {
  try {
    const result = await listPage(TABLES.DUPLICATE_LOG(), { pageSize: 50, pageToken: req.query.pageToken });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/notifications  (own notifications)
router.get('/notifications', authenticate, allStaff, async (req, res, next) => {
  try {
    const result = await listPage(TABLES.NOTIFICATIONS(), {
      filter: `CurrentValue.[Recipient ID] = "${req.user.employeeId}"`,
      pageSize: 20,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// REPORTS / EXPORT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/reports/:type?format=xlsx|csv
// Types: inventory, employee_allocation, overdue, duplicate_logs, damaged, audit_log
router.get('/reports/:type', authenticate, adminOrTL, async (req, res, next) => {
  try {
    const { type } = req.params;
    const format   = req.query.format || 'xlsx';
    const opts     = { startDate: req.query.startDate, endDate: req.query.endDate };
    const { data, contentType, filename } = await rptSvc.exportReport(type, format, opts);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// IMAGE UPLOAD — attach photos to inventory & benchmark records
// ════════════════════════════════════════════════════════════════════════════
const imageSvc = require('../services/imageService');

// POST /api/inventory/:id/image  — upload image to an inventory record
router.post('/inventory/:id/image', authenticate, allStaff, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded. Field name: image' });

    const { buffer, originalname, mimetype } = req.file;
    // Validate it's an image
    if (!mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'File must be an image (jpg, png, webp, etc.)' });
    }
    // Max 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image must be under 10MB' });
    }

    const result = await imageSvc.uploadImageToRecord({
      tableId:    TABLES.INVENTORY(),
      recordId:   req.params.id,
      fileBuffer: buffer,
      fileName:   originalname,
      mimeType:   mimetype,
      fieldName:  'Images',
    });

    // Audit log
    const { log } = require('../services/auditService');
    await log({ ...req.user, action: 'StatusChange', entityType: 'Inventory', entityId: req.params.id, newValue: { image: originalname } });

    res.json({ success: true, fileToken: result.fileToken, message: 'Image uploaded successfully' });
  } catch (err) { next(err); }
});

// POST /api/benchmark/:id/image — upload image to benchmark record
router.post('/benchmark/:id/image', authenticate, authorize(ROLES.ADMIN, ROLES.INVENTORY_HOLDER, ROLES.BENCHMARK), upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
    const { buffer, originalname, mimetype } = req.file;
    if (!mimetype.startsWith('image/')) return res.status(400).json({ success: false, message: 'File must be an image' });

    const result = await imageSvc.uploadImageToRecord({
      tableId:    TABLES.BENCHMARK(),
      recordId:   req.params.id,
      fileBuffer: buffer,
      fileName:   originalname,
      mimeType:   mimetype,
      fieldName:  'Images',
    });
    res.json({ success: true, fileToken: result.fileToken, message: 'Image uploaded successfully' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// BENCHMARK INVENTORY (Admin, BenchmarkViewer, InventoryHolder)
// ════════════════════════════════════════════════════════════════════════════
const benchSvc = require('../services/benchmarkService');
const benchAccess = authorize(ROLES.ADMIN, ROLES.BENCHMARK, ROLES.INVENTORY_HOLDER);

router.get('/benchmark', authenticate, benchAccess, async (req, res, next) => {
  try {
    const { brand, category, pageSize, pageToken } = req.query;
    const result = await benchSvc.listDevices({ brand, category, pageSize: Number(pageSize)||50, pageToken });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/benchmark/stats', authenticate, benchAccess, async (req, res, next) => {
  try {
    const stats = await benchSvc.getStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

router.post('/benchmark', authenticate, authorize(ROLES.ADMIN, ROLES.INVENTORY_HOLDER), validate([
  body('competitorBrand').notEmpty(),
  body('deviceModel').notEmpty(),
]), async (req, res, next) => {
  try {
    const device = await benchSvc.createDevice(req.body, req.user);
    res.status(201).json({ success: true, data: device });
  } catch (err) { next(err); }
});

router.post('/benchmark/bulk-upload', authenticate, authorize(ROLES.ADMIN, ROLES.INVENTORY_HOLDER), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const summary = await benchSvc.bulkUpload(req.file.buffer, req.user);
    res.json({ success: true, summary });
  } catch (err) { next(err); }
});

module.exports = router;
