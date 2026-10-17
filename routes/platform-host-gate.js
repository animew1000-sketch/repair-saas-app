'use strict';
// MOT-030 host isolation. Mount BEFORE express.static and API routes.
// Host restriction is defense in depth; platform-admin.js still enforces MFA/session checks.
const PLATFORM_HOST = 'bendhomeverserver.duckdns.org';
module.exports = function platformHostGate(req, res, next) {
  // req.get('host') is the actual HTTP Host header, not X-Forwarded-Host.
  // Keep exact host and default HTTPS port; don't trust forwarded hostname.
  const host = String(req.get('host') || '').toLowerCase();
  const allowed = host === PLATFORM_HOST || host === PLATFORM_HOST + ':443';
  const pathname = req.path;
  const platformResource = /^\/platform\.(?:html|css|js)$/.test(pathname);
  const platformApi = pathname === '/api/platform' || pathname.startsWith('/api/platform/');
  if (platformResource || platformApi) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (!allowed) return res.status(404).send('Not found');
  }
  next();
};
