// services/userService.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { listAll, createOne, updateOne, findFirst, fieldText, selectText } = require('../utils/bitable');
const { TABLES, ROLES } = require('../config/constants');

function toUser(record) {
  const f = record.fields || {};
  return {
    recordId:   record.record_id,
    employeeId: fieldText(f['Employee ID']),
    fullName:   fieldText(f['Full Name']),
    email:      fieldText(f['Email']),
    role:       selectText(f['Role']),
    department: fieldText(f['Department']),
    tlEmployeeId: fieldText(f['TL Employee ID']),
    isActive:   f['Is Active'] === true || f['Is Active'] === 1,
  };
}

async function findByEmployeeId(employeeId) {
  const r = await findFirst(TABLES.USERS(), `CurrentValue.[Employee ID] = "${employeeId}"`);
  return r || null;
}

async function findUserRecord(employeeId) {
  const r = await findByEmployeeId(employeeId);
  return r ? { ...toUser(r), passwordHash: fieldText(r.fields?.['Password Hash'] || ''), _recordId: r.record_id } : null;
}

async function register({ employeeId, fullName, email, password, role, department, tlEmployeeId }) {
  const existing = await findByEmployeeId(employeeId);
  if (existing) throw new Error(`Employee ID ${employeeId} already registered`);

  const hash = await bcrypt.hash(password, 12);
  const record = await createOne(TABLES.USERS(), {
    'Employee ID':    employeeId,
    'Full Name':      fullName,
    'Email':          email,
    'Password Hash':  hash,
    'Role':           role || ROLES.EMPLOYEE,
    'Department':     department  || '',
    'TL Employee ID': tlEmployeeId || '',
    'Is Active':      true,
  });
  return toUser(record);
}

async function login(employeeId, password) {
  const user = await findUserRecord(employeeId);
  if (!user || !user.isActive) throw new Error('Invalid credentials or account inactive');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign(
    { employeeId: user.employeeId, role: user.role, fullName: user.fullName, recordId: user._recordId },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  return { token, user: { employeeId: user.employeeId, fullName: user.fullName, role: user.role, email: user.email, department: user.department } };
}

async function listUsers() {
  const all = await listAll(TABLES.USERS());
  return all.map(toUser);
}

async function getUserByEmployeeId(employeeId) {
  const r = await findByEmployeeId(employeeId);
  return r ? toUser(r) : null;
}

async function getTL(employeeId) {
  const user = await getUserByEmployeeId(employeeId);
  if (!user?.tlEmployeeId) return null;
  return getUserByEmployeeId(user.tlEmployeeId);
}

module.exports = { register, login, listUsers, getUserByEmployeeId, getTL, findUserRecord };
