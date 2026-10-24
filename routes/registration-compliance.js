'use strict';
// Registration validation is enforced on the server before account creation.
// Does not change existing passwords or force a migration of legacy users.
const COMMON = new Set([
  'password1234', 'password12345', '123456789012', 'qwerty12345',
  'letmein1234', 'admin123456', 'welcome1234', 'iloveyou123',
  'motivo123456', 'password!123', 'passw0rd1234', 'p@ssw0rd1234',
  'password123456', 'password123456789', '1234567890123456',
  'qwertyuiop123', 'qwertyuiop1234', 'changeme12345', 'administrator123',
  'welcome123456', 'motivoauto123', 'repairshop123', 'mysecretpassword'
]);
function validPassword(password) {
  if (typeof password !== 'string') return false;
  const chars = Array.from(password);
  if (chars.length < 12 || chars.length > 128) return false;
  if (Buffer.byteLength(password, 'utf8') > 72) return false; // bcrypt byte limit
  if (password !== password.trim()) return false;
  const normalized = password.normalize('NFKC').toLowerCase();
  if (COMMON.has(normalized)) return false;
  if (/^(.)\1{11,}$/u.test(password) || /^\d+$/u.test(password)) return false;
  return true;
}
function registrationCompliance(req, res, next) {
  if (req.method !== 'POST') return next();
  if (req.body?.age_confirmed !== true) {
    return res.status(400).json({error: 'Confirm that you are at least 13 years old to create an account.'});
  }
  if (!validPassword(req.body?.password)) {
    return res.status(400).json({error: 'Use a password of 12–128 characters (72 UTF-8 bytes maximum), and avoid common passwords.'});
  }
  next();
}
module.exports = registrationCompliance;
module.exports.validPassword = validPassword;
