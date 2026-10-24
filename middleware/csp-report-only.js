'use strict';
// MOTIVO SEC-001: Observe CSP violations without blocking legacy inline scripts.
// Do not switch to enforcement before eliminating inline scripts/styles and
// addressing all legitimate external resources shown in browser reports.
const POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src 'none'",
  "upgrade-insecure-requests"
].join('; ');
function cspReportOnly(req, res, next) {
  res.setHeader('Content-Security-Policy-Report-Only', POLICY);
  next();
}
module.exports = cspReportOnly;
module.exports.POLICY = POLICY;
