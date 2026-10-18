'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const environment = {
  MotivoTranslations: {},
  navigator: { languages: ['en-US'], language: 'en-US' },
  localStorage: { getItem: () => null, setItem: () => {} },
  Intl
};
const context = vm.createContext({ window: environment, Intl });
vm.runInContext(fs.readFileSync(path.join(root, 'public/i18n/es.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8'), context);
const i18n = environment.MotivoI18n;

test('English and Spanish are the only advertised supported languages', () => {
  assert.deepEqual(Array.from(i18n.supportedLanguages()), ['en', 'es']);
  assert.equal(i18n.setLanguage('fr'), false);
});

test('Spanish translations include public, customer, staff and developer terminology', () => {
  const phrases = [
    ['Home', 'Inicio'],
    ['My Jobs', 'Mis trabajos'],
    ['Vehicle Make', 'Marca del vehículo'],
    ['Technician', 'Técnico'],
    ['Shop lifecycle', 'Ciclo de vida del taller'],
    ['Pause shop', 'Suspender taller'],
    ['Parts & Labor', 'Piezas y mano de obra']
  ];
  for (const [source, expected] of phrases) assert.equal(i18n.translate(source, 'es'), expected, source);
});

test('Whitespace, list numbers and casing are preserved', () => {
  assert.equal(i18n.translate('  Home  ', 'es'), '  Inicio  ');
  assert.equal(i18n.translate('1. Dashboard', 'es'), '1. Panel de control');
  assert.equal(i18n.translate('TEAM MANAGEMENT', 'es'), 'ADMINISTRACIÓN DEL EQUIPO');
  assert.equal(i18n.translate('My Jobs →', 'es'), 'Mis trabajos →');
});

test('Unknown phrases and free-form notes are left untouched', () => {
  const note = 'Inspect the right rear brake line on vehicle 1042.';
  assert.equal(i18n.translate(note, 'es'), note);
  assert.equal(i18n.translate('Home', 'en'), 'Home');
});

test('Number, currency and date formatters are exposed', () => {
  assert.equal(typeof i18n.formatNumber, 'function');
  assert.equal(typeof i18n.formatCurrency, 'function');
  assert.equal(typeof i18n.formatDate, 'function');
});

test('Drag-and-drop shared theme loader includes dictionary, runtime and stylesheet', () => {
  const theme = fs.readFileSync(path.join(root, 'public/theme.js'), 'utf8');
  assert.match(theme, /\/i18n\.css\?v=\d+/);
  assert.match(theme, /\/i18n\/es\.js\?v=\d+/);
  assert.match(theme, /\/i18n\.js\?v=\d+/);
  assert.ok(theme.indexOf('dictionary.onload') < theme.indexOf('document.head.appendChild(dictionary)'));
  assert.match(theme, /function toggleTheme\(\)/, 'original theme functionality remains');
});

test('Developer console directly loads dictionary before runtime, and keeps its original script', () => {
  const html = fs.readFileSync(path.join(root, 'public/platform.html'), 'utf8');
  const css = html.indexOf('/i18n.css?v=');
  const dict = html.indexOf('/i18n/es.js?v=');
  const core = html.indexOf('/i18n.js?v=');
  assert.ok(css >= 0 && dict > css && core > dict);
  assert.match(html, /src="\/platform\.js"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="confirmDialog"/);
});


test('Auto (device) uses Spanish for Spanish browsers and preserves manual overrides', () => {
  environment.navigator.languages = ['es-MX', 'en-US'];
  assert.equal(i18n.setLanguage('auto'), true);
  assert.equal(i18n.getLanguage(), 'es');
  assert.equal(i18n.getPreference(), 'auto');
  assert.equal(i18n.setLanguage('en'), true);
  assert.equal(i18n.getLanguage(), 'en');
  assert.equal(i18n.getPreference(), 'en');
  assert.equal(i18n.setLanguage('auto'), true);
  assert.equal(i18n.getLanguage(), 'es');
  environment.navigator.languages = ['de-DE'];
  assert.equal(i18n.setLanguage('auto'), true);
  assert.equal(i18n.getLanguage(), 'en', 'unsupported primary language defaults to English');
});

test('Full-length gradients and reduced-motion support are included', () => {
  const css = fs.readFileSync(path.join(root, 'public/scroll-gradient.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/scroll-gradient.js'), 'utf8');
  const menuCss = fs.readFileSync(path.join(root, 'public/i18n.css'), 'utf8');
  assert.match(css, /background-size: 100% 100%/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /--motivo-glow-mid-x/);
  assert.match(menuCss, /\.theme-footer \{ display: none !important; \}/);
  assert.match(menuCss, /#motivo-side-menu \.motivo-language-control/);
});
