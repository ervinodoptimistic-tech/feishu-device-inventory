// services/imageService.js
// Uploads images to Feishu Bitable as Attachment field values.
// Flow: receive Buffer → POST to Feishu drive/v1/medias/upload_all → get file_token
//       → PATCH the Bitable record's attachment field with [{ file_token }]

require('dotenv').config();
const { APP_TOKEN } = require('../config/constants');

// ── Access token cache ────────────────────────────────────────────────────────
let _token = null, _expiry = 0;

async function getToken() {
  if (_token && Date.now() < _expiry) return _token;
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
  });
  const d = await r.json();
  if (!d.tenant_access_token) throw new Error('Failed to get Feishu token: ' + JSON.stringify(d));
  _token = d.tenant_access_token;
  _expiry = Date.now() + (d.expire - 120) * 1000;
  return _token;
}

// ── Upload file buffer to Feishu media storage ────────────────────────────────
async function uploadMedia(fileBuffer, fileName, mimeType) {
  const token = await getToken();
  const boundary = `Boundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const CRLF = '\r\n';

  const pre = [
    `--${boundary}`, `Content-Disposition: form-data; name="file_name"`, '', fileName,
    `--${boundary}`, `Content-Disposition: form-data; name="parent_type"`, '', 'bitable_file',
    `--${boundary}`, `Content-Disposition: form-data; name="parent_node"`, '', APP_TOKEN(),
    `--${boundary}`, `Content-Disposition: form-data; name="size"`, '', String(fileBuffer.length),
    `--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${mimeType}`, '', '',
  ].join(CRLF);

  const post = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([Buffer.from(pre, 'utf8'), fileBuffer, Buffer.from(post, 'utf8')]);

  const r = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
    method: 'POST',
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const d = await r.json();
  if (d.code !== 0 || !d.data?.file_token) {
    throw new Error(`Feishu media upload failed (code ${d.code}): ${d.msg || JSON.stringify(d)}`);
  }
  return d.data.file_token;
}

// ── Append file_token to a Bitable record's attachment field ─────────────────
async function attachToRecord(tableId, recordId, fileToken, fieldName = 'Images') {
  const token = await getToken();
  const appToken = APP_TOKEN();

  // First read existing attachments so we don't overwrite them
  const getR = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const existing = await getR.json();
  const existingAttachments = existing?.data?.record?.fields?.[fieldName] || [];

  // Merge existing + new
  const newAttachments = [...existingAttachments, { file_token: fileToken }];

  const patchR = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [fieldName]: newAttachments } }),
    }
  );
  const patchD = await patchR.json();
  if (patchD.code !== 0) throw new Error(`Attach failed (code ${patchD.code}): ${patchD.msg}`);
  return patchD.data?.record;
}

// ── Main export ───────────────────────────────────────────────────────────────
async function uploadImageToRecord({ tableId, recordId, fileBuffer, fileName, mimeType, fieldName = 'Images' }) {
  const fileToken = await uploadMedia(fileBuffer, fileName, mimeType);
  const record    = await attachToRecord(tableId, recordId, fileToken, fieldName);
  return { fileToken, record };
}

// Get a signed temporary download URL for viewing an attachment
async function getImageUrl(fileToken, tableId) {
  const token = await getToken();
  const extra = encodeURIComponent(JSON.stringify({ bitablePerm: { tableId } }));
  return `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download?extra=${extra}&token=${token}`;
}

module.exports = { uploadImageToRecord, getImageUrl, getToken };
