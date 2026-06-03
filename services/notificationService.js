// services/notificationService.js
// Handles email sending (Nodemailer) + in-app notification records in Bitable.

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
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send an email (fire-and-forget; never throws).
 */
async function sendEmail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER) {
    console.log(`[Email SKIP — no SMTP config] To: ${to} | ${subject}`);
    return;
  }
  try {
    await getTransport().sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to, subject, html, text,
    });
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
  }
}

/**
 * Save an in-app notification to Bitable and optionally email.
 */
async function notify({ recipientId, email, type, subject, body }) {
  // 1. In-app record
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
    console.error('[Notification] Bitable write failed:', err.message);
  }

  // 2. Email
  if (email) {
    await sendEmail({
      to:      email,
      subject: subject,
      html:    `<div style="font-family:sans-serif;max-width:600px"><h2 style="color:#1a1a2e">${subject}</h2><p>${body.replace(/\n/g,'<br>')}</p><hr><small>Device Inventory System — do not reply</small></div>`,
      text:    body,
    });
  }
}

// ── Pre-built notification templates ─────────────────────────────────────────

async function notifyRequestSubmitted({ employeeName, employeeId, employeeEmail, brand, model, tlEmail, tlId }) {
  // Notify employee
  await notify({
    recipientId: employeeId,
    email:       employeeEmail,
    type:        'RequestSubmitted',
    subject:     'Your device request has been submitted',
    body:        `Hi ${employeeName},\n\nYour request for ${brand} ${model} has been submitted and is awaiting approval from your TL.\n\nYou will be notified once a decision is made.`,
  });
  // Notify TL
  await notify({
    recipientId: tlId,
    email:       tlEmail,
    type:        'RequestPendingApproval',
    subject:     `Device request from ${employeeName} awaiting your approval`,
    body:        `A device request has been submitted by ${employeeName} (${employeeId}) for ${brand} ${model}.\n\nPlease log in to review and approve/reject.`,
  });
}

async function notifyRequestApproved({ employeeName, employeeId, email, brand, model, imei, assignedDate, expectedReturnDate }) {
  await notify({
    recipientId: employeeId,
    email,
    type:    'RequestApproved',
    subject: `Your device request has been approved — ${brand} ${model}`,
    body:    `Hi ${employeeName},\n\nYour request has been approved.\n\nDevice Details:\n  Brand: ${brand}\n  Model: ${model}\n  IMEI:  ${imei}\n  Assigned Date:        ${assignedDate}\n  Expected Return Date: ${expectedReturnDate}\n\nPlease collect the device from the Inventory Holder and sign the acknowledgment form.`,
  });
}

async function notifyRequestRejected({ employeeName, employeeId, email, brand, model, reason }) {
  await notify({
    recipientId: employeeId,
    email,
    type:    'RequestRejected',
    subject: `Your device request has been rejected`,
    body:    `Hi ${employeeName},\n\nYour request for ${brand} ${model} has been rejected.\n\nReason: ${reason}\n\nPlease contact your TL for more information.`,
  });
}

async function notifyDuplicateUpload({ adminEmail, adminId, batchId, duplicates }) {
  await notify({
    recipientId: adminId,
    email:       adminEmail,
    type:        'DuplicateAlert',
    subject:     `⚠️ Duplicate entries blocked in upload batch ${batchId}`,
    body:        `During upload batch ${batchId}, ${duplicates.length} duplicate entries were blocked:\n\n${duplicates.map(d => `• ${d.field}: ${d.value} (Row: ${d.row})`).join('\n')}\n\nPlease review the Duplicate Audit Log.`,
  });
}

async function notifyOverdueReturn({ employeeName, employeeId, email, brand, model, imei, dueDate, tlEmail, tlId }) {
  const msg = `Device ${brand} ${model} (IMEI: ${imei}) assigned to ${employeeName} was due for return on ${dueDate} and has not been returned.`;
  await notify({ recipientId: employeeId, email, type: 'OverdueReturn', subject: `⚠️ Overdue device return reminder`, body: `Hi ${employeeName},\n\n${msg}\n\nPlease return the device immediately.` });
  await notify({ recipientId: tlId, email: tlEmail, type: 'OverdueReturn', subject: `⚠️ Overdue return by ${employeeName}`, body: msg });
}

async function notifyReassignmentBlocked({ adminEmail, adminId, imei, assignedTo }) {
  await notify({
    recipientId: adminId,
    email:       adminEmail,
    type:        'ReassignmentBlocked',
    subject:     `⚠️ Reassignment blocked — device still assigned`,
    body:        `An attempt was made to reassign device with IMEI ${imei}, which is currently assigned to ${assignedTo}.\n\nThe device must be marked as Returned before it can be reassigned.`,
  });
}

module.exports = {
  notify,
  sendEmail,
  notifyRequestSubmitted,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyDuplicateUpload,
  notifyOverdueReturn,
  notifyReassignmentBlocked,
};
