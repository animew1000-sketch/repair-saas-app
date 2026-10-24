'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const middleware = require('../middleware/csp-report-only');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('CSP is report-only to avoid breaking existing frontend scripts', () => {
  const headers = {};
  let called = false;
  middleware({}, {setHeader: (name, value) => {headers[name] = value;}}, () => {called = true;});
  assert.equal(called, true);
  assert.ok(headers['Content-Security-Policy-Report-Only']);
  assert.equal(headers['Content-Security-Policy'], undefined);
});
test('CSP limits script sources and blocks plugins and framing', () => {
  assert.match(middleware.POLICY, /script-src 'self'/);
  assert.match(middleware.POLICY, /object-src 'none'/);
  assert.match(middleware.POLICY, /frame-ancestors 'none'/);
  assert.match(middleware.POLICY, /base-uri 'self'/);
  assert.match(middleware.POLICY, /form-action 'self'/);
  assert.doesNotMatch(middleware.POLICY, /'unsafe-inline'|'unsafe-eval'/);
});
test('CSP report-only middleware is registered before static serving', () => {
  const policy = server.indexOf("app.use(require('./middleware/csp-report-only'));");
  const staticRoute = server.indexOf('express.static(');
  assert.ok(policy >= 0 && policy < staticRoute);
});
