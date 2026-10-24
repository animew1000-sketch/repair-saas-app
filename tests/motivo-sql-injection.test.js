'use strict';
// Read-only SQL injection regression checks. No database or HTTP requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const payloads = [
  "' OR '1'='1",
  "1' OR 1=1 -- ",
  "x'; DROP TABLE users; -- ",
  "' UNION SELECT 1,2,3 -- ",
  '1 OR 1=1'
];

test('registration company lookup binds company ID as parameter', () => {
  const s = read('routes/auth.js');
  assert.match(s, /pool\.query\(['"]SELECT id, company_name FROM companies WHERE id=\? LIMIT 1['"],\s*\[company\]\)/);
});

test('credential lookups use SQL placeholders for login identifiers', () => {
  const s = read('routes/auth.js');
  assert.match(s, /WHERE \(u\.email=\? OR u\.username=\?\)/);
  assert.match(s, /pool\.query\(sql,company\?\[input,input,company\]:\[input,input\]\)/);
  assert.doesNotMatch(s, /\$\{\s*(?:input|password|login_input|username|email)\s*\}/);
});

test('company slug lookup binds path parameter', () => {
  const s = read('routes/companies.js');
  assert.match(s, /c\.slug=\? LIMIT 1['"],\s*\[req\.params\.slug\]/);
});

test('employee permission writes bind shop, employee and permission keys', () => {
  const s = read('routes/employee-permissions.js');
  assert.match(s, /WHERE company_id=\? AND user_id=\? AND permission_key=\?/);
  assert.match(s, /\[req\.user\.company_id,staff\.id,key\]/);
  assert.doesNotMatch(s, /\$\{\s*(?:key|employeeId|req\.body|req\.params)/);
});

test('repair job lookups and writes are parameterized and tenant-scoped', () => {
  const s = read('routes/departments.js');
  assert.match(s, /WHERE id = \? AND company_id = \?/);
  assert.match(s, /WHERE repair_job_id = \? AND company_id = \?/);
  assert.match(s, /\[jobId,\s*req\.user\.company_id\]/);
});

test('scheduling updates bind request values separately from SQL syntax', () => {
  const s = read('routes/scheduling.js');
  assert.match(s, /UPDATE shop_service_bays SET is_active=\? WHERE id=\? AND company_id=\?/);
  assert.match(s, /\[req\.body\.is_active\?1:0,req\.params\.id,company\(req\)\]/);
});

test('known SQL injection strings do not appear interpolated in credential query templates', () => {
  const s = read('routes/auth.js');
  const lookup = s.match(/const sql=`SELECT u\.\*,c\.company_name,c\.primary_color FROM users u JOIN companies c ON u\.company_id=c\.id WHERE \(u\.email=\? OR u\.username=\?\)[^`]*`;/);
  assert.ok(lookup, 'parameterized credentials lookup must exist');
  for (const payload of payloads) assert.ok(!lookup[0].includes(payload));
  assert.match(lookup[0], /\? OR u\.username=\?/);
});

test('registration and login handlers do not expose raw SQL errors in API responses', () => {
  const s = read('routes/auth.js');
  assert.match(s, /function safeLog\(/);
  assert.doesNotMatch(s, /res\.(?:json|send)\(\s*(?:err|error)\s*\)/);
  assert.doesNotMatch(s, /res\.status\(500\)\.json\(\{\s*error\s*:\s*err\.(?:message|sql)/);
});
