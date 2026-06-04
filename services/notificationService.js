// services/notificationService.js  v2
// Beautiful HTML email notifications for all device lifecycle events.

const nodemailer = require('nodemailer');
const { createOne } = require('../utils/bitable');
const { TABLES }    = require('../config/constants');

// ── SMTP transport ────────────────────────────────────────────────────────────
let transporter;
function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// ── HTML email wrapper ────────────────────────────────────────────────────────
function htmlWrap(title, color, body, footer = '') {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:32px 16px">
    <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <!-- Header -->
      <tr><td style="background:${color};padding:24px 32px">
        <p style="margin:0;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.85">TRANSSION — Device Inventory System</p>
        <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:600">${title}</h1>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:28px 32px;color:#333;font-size:14px;line-height:1.7">
        ${body}
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8f9fa;padding:16px 32px;border-top:1px solid #e8eaed">
        <p style="margin:0;color:#888;font-size:12px">${footer || 'This is an automated message from the TRANSSION Device Inventory System. Please do not reply to this email.'}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function deviceCard(fields) {
  const rows = Object.entries(fields).filter(([,v])=>v).map(([k,v])=>
    `<tr><td style="padding:6px 0;color:#666;font-size:13px;width:160px">${k}</td>
     <td style="padding:6px 0;font-weight:500;font-size:13px">${v}</td></tr>`
  ).join('');
  return `<table style="width:100%;background:#f8f9fa;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e8eaed">
    ${rows}
  </table>`;
}

// ── Send email (fire and forget) ──────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER) {
    console.log(`[Email SKIP — no SMTP] To: ${to} | ${subject}`);
    return;
  }
  try {
    await getTransport().sendMail({
      from: process.env.EMAIL_FROM || `"TRANSSION Inventory" <${process.env.SMTP_USER}>`,
      to, subject, html, text,
    });
    console.log(`[Email SENT] To: ${to} | ${subject}`);
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
  }
}

// ── Save in-app notification ──────────────────────────────────────────────────
async function saveInApp({ recipientId, email, type, subject, body }) {
  try {
    await createOne(TABLES.NOTIFICATIONS(), {
      'Recipient ID': recipientId || '',
      'Email':        email       || '',
      'Type':         type        || '',
      'Subject':      subject     || '',
      'Body':         body        || '',
      'Is Read':      false,
    });
  } catch (err) {
    console.error('[Notification] Bitable save failed:', err.message);
  }
}

async function notify({ recipientId, email, type, subject, body, html }) {
  await saveInApp({ recipientId, email, type, subject, body });
  if (email) await sendEmail({ to: email, subject, html: html || `<pre style="font-family:sans-serif">${body}</pre>`, text: body });
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

// 1. Request submitted → notify employee + inventory holder/TL
async function notifyRequestSubmitted({ employeeName, employeeId, employeeEmail, brand, model, holderName, holderEmail, holderId }) {
  // To employee
  const empBody = `<p>Hi <strong>${employeeName}</strong>,</p>
    <p>Your device request has been submitted and is awaiting approval from the Inventory Holder.</p>
    ${deviceCard({ 'Requested Device': `${brand || 'Any brand'} ${model || ''}`, 'Status': '⏳ Pending Approval' })}
    <p>You will receive an email once your request is approved or rejected.</p>`;

  await notify({
    recipientId: employeeId, email: employeeEmail,
    type: 'RequestSubmitted',
    subject: `📱 Device Request Submitted — ${brand || 'Any'} ${model || ''}`,
    body: `Hi ${employeeName}, your device request for ${brand || 'Any'} ${model || ''} has been submitted and is awaiting approval.`,
    html: htmlWrap('Device Request Submitted', '#1a73e8', empBody),
  });

  // To inventory holder / TL
  if (holderEmail) {
    const holderBody = `<p>Hi <strong>${holderName || 'Team'}</strong>,</p>
      <p>A new device request is awaiting your approval.</p>
      ${deviceCard({
        'Requested By': `${employeeName} (${employeeId})`,
        'Device': `${brand || 'Any brand'} ${model || 'Any model'}`,
        'Action Required': '✅ Login to approve or reject',
      })}
      <p>Please log in to the inventory system to review and take action.</p>`;

    await notify({
      recipientId: holderId, email: holderEmail,
      type: 'NewRequestPending',
      subject: `⏳ New Device Request from ${employeeName} — Action Required`,
      body: `${employeeName} has requested a device. Please log in to approve or reject.`,
      html: htmlWrap('New Device Request Pending', '#b45309', holderBody),
    });
  }
}

// 2. Request approved → notify employee with device details
async function notifyRequestApproved({ employeeName, employeeId, email, brand, model, imei, serialNumber, assignedDate, expectedReturnDate, holderName }) {
  const body = `<p>Hi <strong>${employeeName}</strong>,</p>
    <p>🎉 Great news! Your device request has been <strong style="color:#137333">approved</strong>.</p>
    ${deviceCard({
      'Brand':               brand  || '—',
      'Model':               model  || '—',
      'IMEI':                imei   || '—',
      'Serial Number':       serialNumber || '—',
      'Assigned Date':       assignedDate || '—',
      'Expected Return Date':expectedReturnDate || '—',
      'Assigned By':         holderName || 'Inventory Team',
    })}
    <p>Please collect the device from the Inventory Holder and handle it with care.</p>
    <p style="background:#e6f4ea;border-radius:8px;padding:12px;font-size:13px;color:#137333">
      📋 <strong>Please note:</strong> Return the device by <strong>${expectedReturnDate || 'the agreed date'}</strong>. 
      You will receive a reminder if the device is overdue.
    </p>`;

  await notify({
    recipientId: employeeId, email,
    type: 'RequestApproved',
    subject: `✅ Device Assigned to You — ${brand} ${model}`,
    body: `Hi ${employeeName}, your device request is approved. ${brand} ${model} (IMEI: ${imei}) has been assigned to you. Please collect from Inventory Holder.`,
    html: htmlWrap('Device Assigned to You ✅', '#137333', body),
  });
}

// 3. Request rejected → notify employee with reason
async function notifyRequestRejected({ employeeName, employeeId, email, brand, model, reason }) {
  const body = `<p>Hi <strong>${employeeName}</strong>,</p>
    <p>Your device request has been <strong style="color:#c62828">rejected</strong>.</p>
    ${deviceCard({
      'Requested Device': `${brand || 'Any'} ${model || ''}`,
      'Status':           '❌ Rejected',
      'Reason':           reason || 'No reason provided',
    })}
    <p>Please contact your Inventory Holder or manager for more information, or submit a new request if you believe this was in error.</p>`;

  await notify({
    recipientId: employeeId, email,
    type: 'RequestRejected',
    subject: `❌ Device Request Rejected`,
    body: `Hi ${employeeName}, your request for ${brand || 'a device'} has been rejected. Reason: ${reason || 'Not specified'}`,
    html: htmlWrap('Device Request Rejected', '#c62828', body),
  });
}

// 4. Device returned → thank you email to employee + notify holder
async function notifyDeviceReturned({ employeeName, employeeId, email, brand, model, imei, returnDate, condition, holderName, holderEmail, holderId }) {
  // Thank you to employee
  const empBody = `<p>Hi <strong>${employeeName}</strong>,</p>
    <p>Thank you for returning the device! We have received it and it has been logged in our system.</p>
    ${deviceCard({
      'Device':         `${brand} ${model}`,
      'IMEI':           imei || '—',
      'Return Date':    returnDate || '—',
      'Condition':      condition  || '—',
    })}
    <p style="background:#e6f4ea;border-radius:8px;padding:12px;font-size:13px;color:#137333">
      🙏 <strong>Thank you</strong> for taking care of the device and returning it on time. 
      Your cooperation helps the team stay productive!
    </p>`;

  await notify({
    recipientId: employeeId, email,
    type: 'DeviceReturned',
    subject: `🙏 Thank You for Returning ${brand} ${model}`,
    body: `Hi ${employeeName}, thank you for returning ${brand} ${model} (IMEI: ${imei}). The return has been logged successfully.`,
    html: htmlWrap('Device Return Confirmed 🙏', '#1a73e8', empBody),
  });

  // Notify inventory holder
  if (holderEmail) {
    const holderBody = `<p>Hi <strong>${holderName || 'Team'}</strong>,</p>
      <p>A device has been returned and is pending your validation.</p>
      ${deviceCard({
        'Returned By':  `${employeeName} (${employeeId})`,
        'Device':       `${brand} ${model}`,
        'IMEI':         imei || '—',
        'Return Date':  returnDate || '—',
        'Condition':    condition  || '—',
        'Action':       '🔍 Please validate the return in the system',
      })}`;

    await notify({
      recipientId: holderId, email: holderEmail,
      type: 'ReturnPendingValidation',
      subject: `📦 Device Return from ${employeeName} — Validation Required`,
      body: `${employeeName} has returned ${brand} ${model}. Please validate the return in the inventory system.`,
      html: htmlWrap('Device Return — Validation Required', '#b45309', holderBody),
    });
  }
}

// 5. Overdue reminder
async function notifyOverdueReturn({ employeeName, employeeId, email, brand, model, imei, dueDate, daysOverdue }) {
  const body = `<p>Hi <strong>${employeeName}</strong>,</p>
    <p style="color:#c62828">⚠️ The device assigned to you is <strong>${daysOverdue} day(s) overdue</strong>.</p>
    ${deviceCard({
      'Device':         `${brand} ${model}`,
      'IMEI':           imei,
      'Due Date':       dueDate,
      'Days Overdue':   `${daysOverdue} days`,
    })}
    <p>Please return the device immediately or contact your Inventory Holder to arrange an extension.</p>`;

  await notify({
    recipientId: employeeId, email,
    type: 'OverdueReturn',
    subject: `⚠️ Overdue Device Return — ${brand} ${model} (${daysOverdue} days late)`,
    body: `Reminder: ${brand} ${model} (IMEI: ${imei}) was due on ${dueDate} and is ${daysOverdue} days overdue. Please return immediately.`,
    html: htmlWrap('⚠️ Overdue Device Return', '#c62828', body),
  });
}

// 6. Duplicate upload alert
async function notifyDuplicateUpload({ adminEmail, adminId, batchId, duplicates }) {
  await notify({
    recipientId: adminId, email: adminEmail,
    type: 'DuplicateAlert',
    subject: `⚠️ ${duplicates.length} Duplicate(s) Blocked — Batch ${batchId}`,
    body: `During upload batch ${batchId}, ${duplicates.length} duplicate entries were blocked.`,
    html: htmlWrap('Duplicate Upload Alert', '#b45309',
      `<p>During upload batch <strong>${batchId}</strong>, <strong>${duplicates.length}</strong> duplicate entries were blocked:</p>
       <ul>${duplicates.slice(0,20).map(d=>`<li>${d.field}: ${d.value} (Row ${d.row})</li>`).join('')}</ul>`),
  });
}

// 7. Reassignment blocked
async function notifyReassignmentBlocked({ adminEmail, adminId, imei, assignedTo }) {
  await notify({
    recipientId: adminId, email: adminEmail,
    type: 'ReassignmentBlocked',
    subject: `⚠️ Device Reassignment Blocked — IMEI ${imei}`,
    body: `Reassignment blocked for IMEI ${imei} — currently assigned to ${assignedTo}. Device must be returned first.`,
    html: htmlWrap('Reassignment Blocked', '#c62828',
      `<p>An attempt was made to reassign device with IMEI <strong>${imei}</strong>, which is currently assigned to <strong>${assignedTo}</strong>.</p>
       <p>The device must be marked as Returned before it can be reassigned.</p>`),
  });
}

module.exports = {
  notify, sendEmail,
  notifyRequestSubmitted,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyDeviceReturned,
  notifyOverdueReturn,
  notifyDuplicateUpload,
  notifyReassignmentBlocked,
};
