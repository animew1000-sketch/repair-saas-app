const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1',
  port: Number(process.env.SMTP_PORT || 25),
  secure: false,

  // Node and Postfix are on the same server over loopback.
  // Do not attempt STARTTLS using Postfix's local self-signed certificate.
  ignoreTLS: true,

  // Postfix trusts localhost, so no SMTP credentials are required.
  auth: undefined
});

const DEFAULT_FROM =
  process.env.MAIL_FROM ||
  'Repair SaaS <noreply@repairben.dynv6.net>';

/**
 * Send an email through the local Postfix server.
 *
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} [options.text]
 * @param {string} [options.html]
 */
async function sendMail({
  to,
  subject,
  text,
  html
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

  const info =
    await transporter.sendMail({
      from: DEFAULT_FROM,
      to,
      subject,
      text,
      html
    });

  console.log(
    `Email sent to ${to}: ${info.messageId}`
  );

  return info;
}

module.exports = {
  sendMail,
  transporter
};