const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1',
  port: Number(process.env.SMTP_PORT || 25),
  secure: false,
  ignoreTLS: true,
  auth: undefined
});

const DEFAULT_FROM =
  process.env.MAIL_FROM ||
  'Motivo <noreply@repairben.dynv6.net>';

function getDefaultFromAddress() {
  const angleMatch =
    String(DEFAULT_FROM).match(/<([^>]+)>/);

  if (angleMatch) {
    return angleMatch[1].trim();
  }

  return String(DEFAULT_FROM).trim();
}

function cleanDisplayName(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .trim();
}

async function sendMail({
  to,
  subject,
  text,
  html,
  fromName
}) {
  if (!to) {
    throw new Error(
      'sendMail requires a recipient email address.'
    );
  }

  if (!subject) {
    throw new Error(
      'sendMail requires a subject.'
    );
  }

  const safeFromName =
    cleanDisplayName(fromName);

  const from =
    safeFromName
      ? `${safeFromName} <${getDefaultFromAddress()}>`
      : DEFAULT_FROM;

  const info =
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });

  console.log(
    `Email sent to ${to} from ${safeFromName || 'default sender'}: ${info.messageId}`
  );

  return info;
}

module.exports = {
  sendMail,
  transporter
};