'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'departments.js'), 'utf8');

test('Ready for pickup requires repair permission after authentication', () => {
  const route = source.match(/router\.post\(\s*'\/job\/:jobId\/ready',([\s\S]*?)async \(req, res\) =>/);
  assert.ok(route, 'ready endpoint found');
  assert.match(route[1], /authenticateToken/);
  assert.match(route[1], /requireStaff/);
  assert.match(route[1], /requirePermission\('repair'\)/);
});

test('Bulk parts/labor endpoint trusts effective permission, not base role whitelist', () => {
  const route = source.match(/router\.put\('\/job\/:jobId\/line-items',([\s\S]*?)const jobId/);
  assert.ok(route, 'line-items endpoint found');
  assert.match(route[1], /authenticateToken/);
  assert.match(route[1], /requirePermission\('parts_labor'\)/);
  assert.doesNotMatch(route[1], /\['technician','parts_manager','manager'\]/);
});

test('Ready-for-pickup update remains shop scoped', () => {
  const block = source.match(/router\.post\(\s*'\/job\/:jobId\/ready',([\s\S]*?)router\.get\(\s*'\/jobs'/);
  assert.ok(block);
  assert.match(block[1], /WHERE r\.id = \? AND r\.company_id = \?/);
  assert.match(block[1], /WHERE id = \? AND company_id = \?/);
});

test('Parts/labor writes remain shop scoped and transactional', () => {
  const block = source.match(/router\.put\('\/job\/:jobId\/line-items',([\s\S]*?)router\.post\(\s*'\/:name'/);
  assert.ok(block);
  assert.match(block[1], /beginTransaction\(\)/);
  assert.match(block[1], /WHERE id = \? AND company_id = \? FOR UPDATE/);
  assert.match(block[1], /WHERE repair_job_id = \? AND company_id = \?/);
});
