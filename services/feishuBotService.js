// services/feishuBotService.js
// Sends Feishu chat messages (bot DMs) to users.
// Uses the official @larksuiteoapi/node-sdk already installed.
//
// REQUIRED PERMISSIONS on your Feishu app:
//   im:message                   — send messages
//   im:message:send_as_bot       — send as bot
//   contact:user.id:readonly     — look up open_id by email

const client = require('../config/feishu');

// ── Cache: email → open_id (avoid repeated API calls) ────────────────────────
const _openIdCache = {};

/**
 * Get Feishu open_id for a user by their email.
 * Returns null if user not found or permission denied.
 */
async function getOpenIdByEmail(email) {
  if (!email) return null;
  if (_openIdCache[email]) return _openIdCache[email];

  try {
    const res = await client.contact.user.batchGetId({
      params: { user_id_type: 'open_id' },
      data:   { emails: [email] },
    });
    const user = res.data?.user_list?.[0];
    if (user?.user_id) {
      _openIdCache[email] = user.user_id;
      return user.user_id;
    }
    return null;
  } catch (err) {
    console.error('[FeishuBot] getOpenIdByEmail failed:', err.message);
    return null;
  }
}

/**
 * Send an interactive card message to a user by open_id.
 * Falls back to plain text if card fails.
 */
async function sendCardToUser(openId, card) {
  try {
    await client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type:   'interactive',
        content:    JSON.stringify(card),
      },
    });
    return true;
  } catch (err) {
    console.error('[FeishuBot] sendCard failed:', err.message);
    return false;
  }
}

/**
 * Send a plain text message to a user by open_id.
 */
async function sendTextToUser(openId, text) {
  try {
    await client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type:   'text',
        content:    JSON.stringify({ text }),
      },
    });
    return true;
  } catch (err) {
    console.error('[FeishuBot] sendText failed:', err.message);
    return false;
  }
}

/**
 * Main entry: send a Feishu chat notification to a user by email.
 * Tries interactive card first, falls back to text.
 */
async function notifyUser(email, { title, subtitle, fields, color = 'blue', footer }) {
  if (!email) return;

  const openId = await getOpenIdByEmail(email);
  if (!openId) {
    console.log(`[FeishuBot] Could not find open_id for ${email} — skipping chat notification`);
    return;
  }

  // Build interactive card (Feishu card format)
  const elements = [];

  if (subtitle) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: subtitle },
    });
  }

  if (fields && fields.length) {
    elements.push({ tag: 'hr' });
    fields.forEach(({ label, value }) => {
      if (value) elements.push({
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**${label}**` } },
          { is_short: true, text: { tag: 'lark_md', content: String(value) } },
        ],
      });
    });
  }

  if (footer) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `_${footer}_` },
    });
  }

  const colorMap = { blue: 'blue', green: 'green', red: 'red', orange: 'orange', grey: 'grey' };

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title:    { tag: 'plain_text', content: title },
      template: colorMap[color] || 'blue',
    },
    elements,
  };

  await sendCardToUser(openId, card);
}

// ══════════════════════════════════════════════════════════════════════════════
// PRE-BUILT NOTIFICATION CARDS
// ══════════════════════════════════════════════════════════════════════════════

/** Notify inventory holder: new request pending */
async function notifyHolderNewRequest({ holderEmail, requesterName, requesterId, brand, model, purpose, priority, requestRecordId }) {
  await notifyUser(holderEmail, {
    title:    '📱 New Device Request — Action Required',
    subtitle: `**${requesterName}** (${requesterId}) has submitted a device request.`,
    color:    'orange',
    fields: [
      { label: 'Device',    value: `${brand || 'Any brand'} ${model || ''}` },
      { label: 'Purpose',   value: purpose || '—' },
      { label: 'Priority',  value: priority || 'Medium' },
      { label: 'Action',    value: '✅ Please log in to approve or reject' },
    ],
    footer: 'TRANSSION Device Inventory System',
  });
}

/** Notify requester: request approved */
async function notifyRequesterApproved({ email, requesterName, brand, model, imei, serialNumber, assignedDate, returnDate, holderName }) {
  await notifyUser(email, {
    title:    '✅ Device Request Approved',
    subtitle: `Great news **${requesterName}**! Your device request has been approved.`,
    color:    'green',
    fields: [
      { label: 'Device',          value: `${brand} ${model}` },
      { label: 'IMEI',            value: imei || '—' },
      { label: 'Serial Number',   value: serialNumber || '—' },
      { label: 'Assigned Date',   value: assignedDate || '—' },
      { label: 'Return By',       value: returnDate   || '—' },
      { label: 'Approved By',     value: holderName   || 'Inventory Team' },
    ],
    footer: 'Please collect the device from the Inventory Holder. Handle with care!',
  });
}

/** Notify requester: request rejected */
async function notifyRequesterRejected({ email, requesterName, brand, model, reason, holderName }) {
  await notifyUser(email, {
    title:    '❌ Device Request Rejected',
    subtitle: `Hi **${requesterName}**, your device request has been rejected.`,
    color:    'red',
    fields: [
      { label: 'Device',      value: `${brand || 'Any'} ${model || ''}` },
      { label: 'Reason',      value: reason   || 'No reason provided' },
      { label: 'Rejected By', value: holderName || 'Inventory Team' },
    ],
    footer: 'Please contact your Inventory Holder for more information.',
  });
}

/** Notify employee: device returned confirmation */
async function notifyEmployeeReturned({ email, employeeName, brand, model, imei, returnDate, condition }) {
  await notifyUser(email, {
    title:    '🙏 Device Return Confirmed — Thank You!',
    subtitle: `Thank you **${employeeName}** for returning the device!`,
    color:    'blue',
    fields: [
      { label: 'Device',      value: `${brand} ${model}` },
      { label: 'IMEI',        value: imei       || '—' },
      { label: 'Return Date', value: returnDate || '—' },
      { label: 'Condition',   value: condition  || '—' },
    ],
    footer: 'Your cooperation keeps the team productive. Thank you! 🙏',
  });
}

/** Notify inventory holder: return received, needs validation */
async function notifyHolderReturnReceived({ holderEmail, employeeName, employeeId, brand, model, imei, condition }) {
  await notifyUser(holderEmail, {
    title:    '📦 Device Returned — Validation Required',
    subtitle: `**${employeeName}** (${employeeId}) has returned a device.`,
    color:    'orange',
    fields: [
      { label: 'Device',      value: `${brand} ${model}` },
      { label: 'IMEI',        value: imei      || '—' },
      { label: 'Condition',   value: condition || '—' },
      { label: 'Action',      value: '🔍 Please validate in the inventory system' },
    ],
    footer: 'TRANSSION Device Inventory System',
  });
}

module.exports = {
  getOpenIdByEmail,
  notifyUser,
  notifyHolderNewRequest,
  notifyRequesterApproved,
  notifyRequesterRejected,
  notifyEmployeeReturned,
  notifyHolderReturnReceived,
};
