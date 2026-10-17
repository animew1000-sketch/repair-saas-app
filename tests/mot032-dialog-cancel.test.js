'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.html'), 'utf8');
test('Cancel bypasses required-field validation in the shop status dialog', () => {
  const cancel = html.match(/<button\b[^>]*\bvalue="cancel"[^>]*>Cancel<\/button>/);
  assert.ok(cancel, 'Cancel button exists');
  assert.match(cancel[0], /\bformnovalidate\b/, 'Cancel must skip form validation');
});
test('Confirm still requires validation of the reason field', () => {
  assert.match(html, /<button\b[^>]*\bid="confirmSubmit"[^>]*\bvalue="confirm"/);
  assert.match(html, /id="reason"/);
});
