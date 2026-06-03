// utils/bitable.js
// Generic CRUD helpers around the Feishu Bitable API.
// All services import from here to avoid duplicating SDK calls.

const client   = require('../config/feishu');
const { APP_TOKEN } = require('../config/constants');

// ── helpers ──────────────────────────────────────────────────────────────────

/** Pull text out of a Feishu field value regardless of its wrapper type. */
function fieldText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string')  return val;
  if (typeof val === 'number')  return String(val);
  if (Array.isArray(val))       return val.map(v => v?.text ?? v).filter(Boolean).join(', ');
  if (typeof val === 'object' && val.text !== undefined) return val.text;
  return String(val);
}

/** Extract single-select text value. */
function selectText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val))      return val[0]?.text || val[0] || '';
  if (val.text)                return val.text;
  return String(val);
}

function toTimestamp(val) {
  if (!val) return null;
  if (typeof val === 'number') return val;
  return null;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * List all records in a table (auto-paginates).
 * @param {string} tableId
 * @param {object} opts  { filter, pageSize }
 */
async function listAll(tableId, { filter, pageSize = 100 } = {}) {
  let all = [], pageToken;
  do {
    const res = await client.bitable.appTableRecord.list({
      path:   { app_token: APP_TOKEN(), table_id: tableId },
      params: { page_size: pageSize, page_token: pageToken, filter },
    });
    all.push(...(res.data?.items || []));
    pageToken = res.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);
  return all;
}

/**
 * List records with pagination (single page).
 */
async function listPage(tableId, { filter, pageSize = 50, pageToken } = {}) {
  const res = await client.bitable.appTableRecord.list({
    path:   { app_token: APP_TOKEN(), table_id: tableId },
    params: { page_size: pageSize, page_token: pageToken, filter },
  });
  return {
    items:     res.data?.items || [],
    hasMore:   res.data?.has_more || false,
    pageToken: res.data?.page_token || null,
    total:     res.data?.total || 0,
  };
}

/** Get one record by record_id. Returns null if not found. */
async function getOne(tableId, recordId) {
  try {
    const res = await client.bitable.appTableRecord.get({
      path: { app_token: APP_TOKEN(), table_id: tableId, record_id: recordId },
    });
    return res.data?.record || null;
  } catch (_) { return null; }
}

/** Create one record. Returns the created record. */
async function createOne(tableId, fields) {
  const res = await client.bitable.appTableRecord.create({
    path: { app_token: APP_TOKEN(), table_id: tableId },
    data: { fields },
  });
  if (!res.data?.record) throw new Error('Bitable create failed');
  return res.data.record;
}

/** Update one record. Returns updated record. */
async function updateOne(tableId, recordId, fields) {
  const res = await client.bitable.appTableRecord.update({
    path: { app_token: APP_TOKEN(), table_id: tableId, record_id: recordId },
    data: { fields },
  });
  if (!res.data?.record) throw new Error('Bitable update failed');
  return res.data.record;
}

/** Batch create up to 500 records. */
async function batchCreate(tableId, recordsData) {
  const chunks = [];
  for (let i = 0; i < recordsData.length; i += 500) {
    chunks.push(recordsData.slice(i, i + 500));
  }
  const results = [];
  for (const chunk of chunks) {
    const res = await client.bitable.appTableRecord.batchCreate({
      path: { app_token: APP_TOKEN(), table_id: tableId },
      data: { records: chunk.map(f => ({ fields: f })) },
    });
    results.push(...(res.data?.records || []));
  }
  return results;
}

/** Find first record matching a filter string. */
async function findFirst(tableId, filter) {
  const res = await client.bitable.appTableRecord.list({
    path:   { app_token: APP_TOKEN(), table_id: tableId },
    params: { page_size: 1, filter },
  });
  return res.data?.items?.[0] || null;
}

module.exports = { listAll, listPage, getOne, createOne, updateOne, batchCreate, findFirst, fieldText, selectText, toTimestamp };
