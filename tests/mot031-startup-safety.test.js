'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('database startup is read-only and connection is verified before listening', () => {
  assert.match(source, /async function verifyDatabase\(\)/);
  assert.match(source, /await pool\.query\('SELECT 1'\)/);
  assert.match(source, /await verifyDatabase\(\);[\s\S]*?app\.listen\(/);
});
test('no automatic schema mutations, demo accounts or credentials in server.js', () => {
  for (const pattern of [/\binitDatabase\b/, /\bCREATE\s+TABLE\b/i, /\bALTER\s+TABLE\b/i, /\bINSERT\s+INTO\b/i, /manager123/, /'111111'/]) {
    assert.doesNotMatch(source, pattern);
  }
});
test('database check errors do not print raw mysql objects', () => {
  assert.match(source, /MySQL startup check failed:[\s\S]*?error\?\.code/);
  assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\s*\)/);
});
test('platform administration remains registered before ordinary API routes', () => {
  const admin = source.indexOf("app.use('/api/platform', require('./routes/platform-admin'));");
  const gate = source.indexOf("app.use(require('./routes/platform-status-gate'));");
  const ordinary = source.indexOf("app.use('/api/companies', companiesRoutes);");
  assert.ok(admin >= 0 && gate > admin && ordinary > gate);
});
test('developer host gate precedes public file serving', () => {
  const gate = source.indexOf("app.use(require('./routes/platform-host-gate'));");
  const staticFiles = source.indexOf('express.static(');
  assert.ok(gate >= 0 && staticFiles > gate);
});
test('existing MOT-028 and employee permission routes remain registered', () => {
  assert.match(source, /routes\/mot028-booking/);
  assert.match(source, /routes\/employee-permissions/);
  assert.match(source, /app\.use\('\/api\/customer', customerRoutes\)/);
});
