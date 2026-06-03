// config/constants.js
// Single source of truth for all field names, statuses, and roles.

const ROLES = {
  ADMIN:            'Admin',
  TL:               'TL',
  INVENTORY_HOLDER: 'InventoryHolder',
  EMPLOYEE:         'Employee',
};

const DEVICE_STATUS = {
  NEW:       'New',
  AVAILABLE: 'Available',
  ASSIGNED:  'Assigned',
  RETURNED:  'Returned',
  DAMAGED:   'Damaged',
  SCRAPPED:  'Scrapped',
};

const REQUEST_STATUS = {
  PENDING:            'Pending',
  PENDING_CLARIFICATION: 'Pending Clarification',
  APPROVED:           'Approved',
  REJECTED:           'Rejected',
  FULFILLED:          'Fulfilled',
  OVERDUE:            'Overdue',
};

const AUDIT_ACTIONS = {
  UPLOAD:           'Upload',
  ASSIGNMENT:       'Assignment',
  RETURN:           'Return',
  REALLOCATION:     'Reallocation',
  REQUEST_CREATED:  'RequestCreated',
  REQUEST_APPROVED: 'RequestApproved',
  REQUEST_REJECTED: 'RequestRejected',
  AMENDMENT:        'Amendment',
  DUPLICATE_BLOCKED:'DuplicateBlocked',
  STATUS_CHANGE:    'StatusChange',
  LOGIN:            'Login',
};

// Bitable table env-var keys
const TABLES = {
  INVENTORY:     () => process.env.TABLE_INVENTORY,
  USERS:         () => process.env.TABLE_USERS,
  REQUESTS:      () => process.env.TABLE_REQUESTS,
  ASSIGNMENTS:   () => process.env.TABLE_ASSIGNMENTS,
  RETURNS:       () => process.env.TABLE_RETURNS,
  AUDIT_LOG:     () => process.env.TABLE_AUDIT_LOG,
  DUPLICATE_LOG: () => process.env.TABLE_DUPLICATE_LOG,
  AMENDMENTS:    () => process.env.TABLE_AMENDMENTS,
  NOTIFICATIONS: () => process.env.TABLE_NOTIFICATIONS,
};

const APP_TOKEN = () => process.env.BITABLE_APP_TOKEN;

module.exports = { ROLES, DEVICE_STATUS, REQUEST_STATUS, AUDIT_ACTIONS, TABLES, APP_TOKEN };
