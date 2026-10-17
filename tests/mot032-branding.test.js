'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
test('favicon exists with valid ICO header', () => {
  const ico = fs.readFileSync(path.join(base, 'favicon.ico'));
  assert.ok(ico.length > 100);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
});
test('developer dashboard displays the existing official wordmark', () => {
  const html = read('platform.html');
  assert.match(html, /images\/Motivo-white-word-transparent\.png/);
  assert.match(html, /platform-brand-logo/);
  assert.doesNotMatch(html, /class=\"mark\">M<\/div>/);
});
test('developer dashboard defines its favicon', () => {
  const html = read('platform.html');
  assert.match(html, /rel=\"icon\"[^>]*href=\"\/favicon\.ico\"/);
});
test('developer dashboard authentication form and controls remain intact', () => {
  const html = read('platform.html');
  for (const id of ['loginForm', 'workspace', 'shopForm', 'drawer', 'confirmForm'])
    assert.ok(html.includes(`id=\"${id}\"`));
});
