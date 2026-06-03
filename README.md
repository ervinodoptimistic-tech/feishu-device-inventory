# 📱 Device Sample Inventory Management System
### Feishu Bitable + Node.js + Express

A full-featured device sample management system built on Feishu Open Platform, covering the complete lifecycle: **Bulk Upload → Request → TL Approval → Assignment → Return → Reallocation** — with full RBAC, audit trail, duplicate detection, and export.

---

## Architecture

```
feishu-device-inventory/
├── config/
│   ├── feishu.js          # Feishu SDK client singleton
│   └── constants.js       # Roles, statuses, table refs
├── middleware/
│   ├── auth.js            # JWT verify + RBAC guards
│   └── errorHandler.js
├── routes/
│   └── index.js           # All 30+ endpoints
├── services/
│   ├── inventoryService.js   # Device CRUD, bulk upload, duplicate detection
│   ├── requestService.js     # Request/approval workflow
│   ├── returnService.js      # Return & validation workflow
│   ├── amendmentService.js   # Controlled correction workflow
│   ├── reportService.js      # Excel/CSV export
│   ├── userService.js        # Auth, JWT, user management
│   ├── auditService.js       # Immutable audit log
│   └── notificationService.js # Email + in-app notifications
├── utils/
│   └── bitable.js         # Generic Bitable CRUD helpers
└── src/
    ├── index.js            # Express server
    ├── setup.js            # One-time Bitable table setup
    └── generateTemplate.js # Excel upload template generator
```

---

## Bitable Tables (9 total)

| Table | Purpose |
|-------|---------|
| Inventory | Master device record |
| Users | Employee accounts + roles |
| Requests | Device request forms |
| Assignments | Assignment records |
| Returns | Return records |
| AuditLog | Immutable activity log |
| DuplicateLog | Blocked duplicate attempts |
| Amendments | Correction request workflow |
| Notifications | In-app + email log |

---

## Setup

### 1. Create Feishu App
1. Go to https://open.feishu.cn/app → Create Custom App
2. Enable permission: `bitable:app`
3. Copy **App ID** and **App Secret**

### 2. Configure .env
```bash
cp .env.example .env
# Fill in FEISHU_APP_ID, FEISHU_APP_SECRET, JWT_SECRET, SMTP settings
```

### 3. Install & Setup
```bash
npm install
npm run setup        # Creates all 9 Bitable tables, prints IDs
# Paste the IDs into .env
npm run dev          # Start server
```

### 4. Generate Upload Template
```bash
node src/generateTemplate.js
# Creates inventory_bulk_upload_template.xlsx
```

---

## Role-Based Access Control (RBAC)

| Action | Employee | InventoryHolder | TL | Admin |
|--------|:--------:|:---------------:|:--:|:-----:|
| View own devices | ✅ | ✅ | ✅ | ✅ |
| View all inventory | ❌ | ✅ | ✅ | ✅ |
| Bulk upload | ❌ | ✅ | ❌ | ✅ |
| Submit device request | ✅ | ✅ | ✅ | ✅ |
| Approve/Reject request | ❌ | ❌ | ✅ | ✅ |
| Submit return | ✅ | ✅ | ✅ | ✅ |
| Validate return | ❌ | ✅ | ❌ | ✅ |
| View audit log | ❌ | ❌ | ✅ | ✅ |
| Approve amendments | ❌ | ❌ | ❌ | ✅ |
| Export reports | ❌ | ❌ | ✅ | ✅ |
| **Delete records** | ❌ | ❌ | ❌ | ❌ |

---

## API Reference

### Auth
```
POST /api/auth/register   { employeeId, fullName, email, password, role, department, tlEmployeeId }
POST /api/auth/login      { employeeId, password }
GET  /api/auth/me         → current user
GET  /api/users           → list all users (Admin)
```

### Inventory
```
GET  /api/inventory                        ?status=&brand=&location=&hwStage=
GET  /api/inventory/dashboard              → stats: byStatus, byBrand, overdueCount
GET  /api/inventory/:id
POST /api/inventory                        { brand, deviceModel, imei1, ... }
POST /api/inventory/bulk-upload            multipart/form-data, field: file (.xlsx/.csv)
PATCH /api/inventory/:id/status            { deviceStatus }
```

### Requests
```
GET  /api/requests                         ?status=&employeeId=
POST /api/requests                         { purpose, durationRequired, preferredBrand, preferredModel, priority, ... }
POST /api/requests/:id/approve             { inventoryRecordId, expectedReturnDate, remarks }
POST /api/requests/:id/reject              { reason }
POST /api/requests/:id/clarify             { message }
```

### Returns
```
GET  /api/returns
POST /api/returns                          { inventoryRecordId, physicalCondition, accessoriesPresent, conditionRemarks }
POST /api/returns/:id/validate             { isValid, validatorRemarks, overrideStatus }
```

### Amendments (No deletion — corrections only via workflow)
```
GET  /api/amendments                       (Admin)
POST /api/amendments                       { tableName, recordId, fieldName, requestedValue, justification }
POST /api/amendments/:id/approve           { remarks }
POST /api/amendments/:id/reject            { remarks }
```

### Reports (download)
```
GET /api/reports/inventory?format=xlsx
GET /api/reports/employee_allocation?format=csv
GET /api/reports/overdue
GET /api/reports/duplicate_logs
GET /api/reports/damaged
GET /api/reports/audit_log?startDate=2025-01-01&endDate=2025-12-31
```

### Audit & Notifications
```
GET /api/audit-log
GET /api/duplicate-log
GET /api/notifications
```

---

## Bulk Upload

1. Download template: `node src/generateTemplate.js`
2. Fill in devices (mandatory: Brand, Device Model, Sample/HW Type, HW Stage, IMEI1, Color, Storage/RAM, Warehouse, Inventory Holder)
3. Upload via `POST /api/inventory/bulk-upload` with field `file`

**Response:**
```json
{
  "summary": {
    "batchId": "BATCH-1715000000000-A1B2C3",
    "total": 100,
    "success": 94,
    "failed": 6,
    "duplicates": 4,
    "missingData": 2,
    "errors": [{ "row": 5, "reason": "Missing: IMEI1", "data": {...} }]
  }
}
```

---

## Device Lifecycle

```
NEW → AVAILABLE → ASSIGNED → RETURNED → AVAILABLE (reassignable)
                           → DAMAGED
                           → SCRAPPED
```

---

## Automated Notifications

| Event | Recipients |
|-------|-----------|
| Request submitted | Employee + TL |
| Request approved (with IMEI/device details) | Employee |
| Request rejected (with reason) | Employee |
| Duplicate upload blocked | Admin |
| Overdue return | Employee + TL |
| Reassignment blocked | Admin |

---

## Security

- JWT authentication (8h expiry)
- RBAC on every endpoint
- **No delete operation exists anywhere in the system**
- All state changes write to immutable AuditLog
- Employees can only see/access their own assigned devices
- Duplicate detection prevents IMEI/VC ID conflicts at upload and assignment

---

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| FEISHU_APP_ID | ✅ | From Feishu Developer Console |
| FEISHU_APP_SECRET | ✅ | From Feishu Developer Console |
| BITABLE_APP_TOKEN | ✅ | Generated by `npm run setup` |
| TABLE_INVENTORY | ✅ | Generated by `npm run setup` |
| TABLE_USERS | ✅ | Generated by `npm run setup` |
| TABLE_REQUESTS | ✅ | Generated by `npm run setup` |
| TABLE_ASSIGNMENTS | ✅ | Generated by `npm run setup` |
| TABLE_RETURNS | ✅ | Generated by `npm run setup` |
| TABLE_AUDIT_LOG | ✅ | Generated by `npm run setup` |
| TABLE_DUPLICATE_LOG | ✅ | Generated by `npm run setup` |
| TABLE_AMENDMENTS | ✅ | Generated by `npm run setup` |
| TABLE_NOTIFICATIONS | ✅ | Generated by `npm run setup` |
| JWT_SECRET | ✅ | Long random string |
| SMTP_HOST | ⚠️ | Email notifications |
| SMTP_USER | ⚠️ | Email notifications |
| SMTP_PASS | ⚠️ | Email notifications |
| PORT | ❌ | Default: 3000 |
