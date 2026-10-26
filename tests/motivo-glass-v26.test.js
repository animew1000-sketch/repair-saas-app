'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const css = read('public/motivo-glass-v25.css');
const shared = read('public/i18n.css');
test('shared Motivo theme imports glass file', () => {
  assert.match(shared, /@import\s+url\(['"]?\/motivo-glass-v25\.css/);
});
test('staff KPI, chart and navigation surfaces are included', () => {
  for(const selector of ['.motivo-ops-stat','.motivo-ops-card','#motivoOpsSidebar','.motivo-ops-heading'])
    assert.ok(css.includes(selector), selector);
});
test('customer and marketing cards inherit glass', () => {
  for(const selector of ['.customer-home-card','.customer-home-shop-card','.feature-card'])
    assert.ok(css.includes(selector), selector);
});
test('glass includes light, dark, mobile and reduced motion treatments', () => {
  for(const token of ['body.dark-mode','@media (max-width: 720px)','prefers-reduced-motion','backdrop-filter'])
    assert.ok(css.includes(token), token);
});
test('no server, routes or database changes needed for this styling layer', () => {
  assert.doesNotMatch(css, /<script\b|\bfetch\s*\(|\bSELECT\s+\*/i);
});
