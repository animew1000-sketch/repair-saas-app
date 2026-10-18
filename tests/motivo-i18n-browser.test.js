'use strict';
// Minimal browser DOM harness: verifies runtime DOM updates without third-party test dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const rootPath = path.join(__dirname, '..');

class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentElement = null; }
}
class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attrs = Object.create(null);
    this.hidden = false;
    this.value = '';
    this.id = '';
  }
  appendChild(node) { node.parentElement = this; this.childNodes.push(node); return node; }
  insertBefore(node, before) {
    node.parentElement = this;
    const index = this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? 0 : index, 0, node);
    return node;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map(c => c.nodeType === 3 ? c.nodeValue : c.textContent).join(''); }
  set textContent(value) { this.childNodes = []; this.appendChild(new TextNode(value)); }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  matches(selector) { return selector.startsWith('input[') && this.tagName === 'INPUT'; }
  closest(selector) {
    for (let n = this; n; n = n.parentElement) {
      if (n.hasAttribute('data-i18n-ignore') && selector.includes('data-i18n-ignore')) return n;
      if (n.hasAttribute('translate') && n.getAttribute('translate') === 'no') return n;
      if (['SCRIPT','STYLE','TEXTAREA','SVG'].includes(n.tagName)) return n;
    }
    return null;
  }
  querySelector(selector) {
    const descendants = flatten(this).slice(1);
    return descendants.find(n => n.nodeType === 1 && (selector === 'label' ? n.tagName === 'LABEL' : false)) || null;
  }
  addEventListener(name, callback) { this['on' + name] = callback; }
}
function flatten(root) {
  return [root, ...(root.childNodes || []).flatMap(flatten)];
}
function makeBrowser() {
  const html = new Element('html');
  const head = html.appendChild(new Element('head'));
  const title = head.appendChild(new Element('title'));
  title.appendChild(new TextNode('Motivo | Customer Portal'));
  const body = html.appendChild(new Element('body'));
  const home = body.appendChild(new Element('h1'));
  home.appendChild(new TextNode('Home'));
  const input = body.appendChild(new Element('input'));
  input.setAttribute('placeholder', 'Email Address');
  input.value = 'Customer original value';
  const customerData = body.appendChild(new Element('div'));
  customerData.setAttribute('data-i18n-ignore','');
  customerData.appendChild(new TextNode('Home'));
  const doc = {
    documentElement: html, body, readyState: 'complete',
    createElement: name => new Element(name),
    getElementById: id => flatten(html).find(node => node.nodeType === 1 && node.id === id) || null,
    createTreeWalker: node => {
      const nodes = flatten(node).slice(1);
      let index = 0;
      return { currentNode: null, nextNode() { this.currentNode = nodes[index++]; return !!this.currentNode; } };
    },
    dispatchEvent() {}
  };
  const root = {
    document: doc,
    location: { pathname: '/' },
    navigator: { languages: ['en-US'] },
    localStorage: { getItem: () => null, setItem: () => {} },
    CustomEvent: class { constructor(name, data) { this.name = name; this.detail = data.detail; } },
    MutationObserver: class { constructor(cb) { root.observerCallback = cb; } observe() {} }
  };
  const context = vm.createContext({ window: root, Intl });
  vm.runInContext(fs.readFileSync(path.join(rootPath, 'public/i18n/es.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootPath, 'public/i18n.js'), 'utf8'), context);
  return { root, home, input, customerData, body };
}

test('selector, DOM text and attributes change when Spanish is chosen', () => {
  const {root, home, input, customerData} = makeBrowser();
  assert.ok(root.document.getElementById('motivo-language-select'));
  assert.equal(home.textContent, 'Home');
  assert.equal(root.MotivoI18n.setLanguage('es'), true);
  assert.equal(home.textContent, 'Inicio');
  assert.equal(input.getAttribute('placeholder'), 'Dirección de correo electrónico');
  assert.equal(input.value, 'Customer original value');
  assert.equal(customerData.textContent, 'Home', 'marked free-form areas are untouched');
  assert.equal(root.document.documentElement.lang, 'es');
  assert.equal(root.document.getElementById('motivo-language-select').value, 'es');
  assert.equal(root.MotivoI18n.setLanguage('en'), true);
  assert.equal(home.textContent, 'Home');
  assert.equal(input.getAttribute('placeholder'), 'Email Address');
});

test('text inserted after load is translated without changing data values', () => {
  const {root, body} = makeBrowser();
  root.MotivoI18n.setLanguage('es');
  const item = body.appendChild(new Element('button'));
  item.appendChild(new TextNode('My Jobs'));
  root.observerCallback([{ type: 'childList', addedNodes: [item] }]);
  assert.equal(item.textContent, 'Mis trabajos');
  item.childNodes[0].nodeValue = 'Cancel';
  root.observerCallback([{ type: 'characterData', target: item.childNodes[0] }]);
  assert.equal(item.textContent, 'Cancelar');
  root.MotivoI18n.setLanguage('en');
  assert.equal(item.textContent, 'Cancel');
});
