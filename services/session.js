'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const ACCESS_SECONDS = 10 * 60;
const COOKIE = 'motivo_session';
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET missing');

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function cookieAttributes() {
  // Nginx terminates HTTPS; do not trust arbitrary X-Forwarded-* headers here.
  return `HttpOnly; SameSite=Strict; Path=/api/session; Max-Age=${ABSOLUTE_MS / 1000}; Secure`;
}
function setCookie(res, raw) { res.setHeader('Set-Cookie', `${COOKIE}=${raw}; ${cookieAttributes()}`); }
function clearCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/session; Max-Age=0; Secure`); }
function getRawCookie(req) {
  const match = String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`));
  const value = match ? match.slice(COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function csrfGuard(req, res, next) {
  // The refresh cookie is same-site, but only same-origin POSTs may use it.
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({error:'Cross-origin session request denied.'});
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({error:'Cross-origin session request denied.'}); }
    catch (_) { return res.status(403).json({error:'Invalid request origin.'}); }
  }
  next();
}
function issueAccess(user, sid) {
  return jwt.sign({id:user.id,company_id:user.company_id,company_name:user.company_name,primary_color:user.primary_color,username:user.username,email:user.email,role:user.role,customer_id:user.customer_id,sid}, secret, {expiresIn:ACCESS_SECONDS});
}
async function createSession(user, res) {
  const sid = crypto.randomUUID();
  const raw = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO auth_sessions (id, token_hash, user_id, company_id, created_at, last_activity_at, revoked_at) VALUES (?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),NULL)', [sid,hash(raw),user.id,user.company_id]);
  setCookie(res,raw);
  return issueAccess(user,sid);
}
async function readSession(req) {
  const raw = getRawCookie(req);
  if (!raw) return null;
  const [rows] = await pool.query('SELECT id,user_id,company_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND last_activity_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 HOUR) LIMIT 1',[hash(raw)]);
  const row=rows[0];
  if(!row || row.revoked_at) return null;
  return row;
}
async function revokeCookieSession(req,res) {
  const raw=getRawCookie(req);
  if(raw) await pool.query('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP() WHERE token_hash=? AND revoked_at IS NULL',[hash(raw)]);
  clearCookie(res);
}
module.exports={IDLE_MS,ABSOLUTE_MS,ACCESS_SECONDS,csrfGuard,issueAccess,createSession,readSession,revokeCookieSession,clearCookie,pool};
