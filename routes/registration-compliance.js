'use strict';
// Motivo v22: fail-closed, server-side validation for customer registration.
// This runs before routes/auth.js; do not rely on client-side checkbox checks.
const COMMON = new Set([
  'password1234','password12345','123456789012','qwerty12345',
  'letmein1234','admin123456','welcome1234','iloveyou123',
  'motivo123456','password!123','passw0rd1234','p@ssw0rd1234'
]);
function validPassword(password) {
  if (typeof password !== 'string') return false;
  const length = Array.from(password).length;
  if (length < 12 || length > 128 || Buffer.byteLength(password,'utf8') > 72) return false;
  if (password !== password.trim() || COMMON.has(password.toLowerCase())) return false;
  if (/^(.)\1{11,}$/u.test(password) || /^\d+$/u.test(password)) return false;
  return true;
}
function registrationCompliance(req, res, next) {
  if (req.method !== 'POST') return next();
  if (req.body?.age_confirmed !== true) {
    return res.status(400).json({error:'Confirm that you are at least 13 years old to create an account.'});
  }
  if (!validPassword(req.body?.password)) {
    return res.status(400).json({error:'Use a password of 12–128 characters (72 UTF-8 bytes maximum). Avoid common passwords.'});
  }
  return next();
}
module.exports = registrationCompliance;
module.exports.validPassword = validPassword;
