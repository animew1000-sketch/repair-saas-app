/* Motivo i18n: shared, dependency-free localization for all browser pages.
 * Translates only explicitly known interface phrases, never freeform text via an external service.
 * Add new dictionaries in /i18n/ and register them in AVAILABLE below.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'motivo.ui.language.v1';
  const AVAILABLE = Object.freeze({
    en: { nativeName: 'English', label: 'English', dir: 'ltr' },
    es: { nativeName: 'Español', label: 'Español', dir: 'ltr' }
  });
  const IGNORE_SELECTOR = 'script, style, noscript, template, textarea, pre, code, svg, [contenteditable], [translate="no"], [data-i18n-ignore]';
  const renderedText = new WeakMap();
  const renderedAttrs = new WeakMap();
  const TRANSLATED_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const translations = root.MotivoTranslations || {};

  function normalize(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function safeRead() {
    try { return root.localStorage && root.localStorage.getItem(STORAGE_KEY); }
    catch (_) { return null; }
  }

  function safeWrite(code) {
    try { if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, code); }
    catch (_) { /* Browsers may disable storage. */ }
  }

  function browserLanguage() {
    const languages = (root.navigator && (root.navigator.languages || [root.navigator.language])) || ['en'];
    for (const language of languages) {
      const code = String(language || '').toLowerCase().split('-')[0];
      if (Object.prototype.hasOwnProperty.call(AVAILABLE, code)) return code;
    }
    return 'en';
  }

  // An explicit English/Spanish selection wins; Auto follows browser/device preferences.
  let preference = AVAILABLE[safeRead()] ? safeRead() : 'auto';
  let locale = preference === 'auto' ? browserLanguage() : preference;
  const lookupCaches = Object.create(null);

  function lookup(input, code) {
    const source = normalize(input);
    if (!source || code === 'en') return source;
    const dict = translations[code];
    if (!dict) return source;
    if (Object.prototype.hasOwnProperty.call(dict, source)) return dict[source];
    if (!lookupCaches[code]) {
      const lowerMap = Object.create(null);
      for (const key of Object.keys(dict)) {
        const lower = key.toLocaleLowerCase('en');
        if (!(lower in lowerMap)) lowerMap[lower] = dict[key];
      }
      lookupCaches[code] = lowerMap;
    }
    let translated = lookupCaches[code][source.toLocaleLowerCase('en')];
    if (translated == null) {
      // Common numbering and trailing arrow patterns reuse the base phrase.
      const match = /^(\d+[.)]\s*|[←↩▦▤♙]\s*|[+↻]\s*)(.+?)(\s*[→↗])?$/.exec(source);
      if (match) {
        const inner = lookup(match[2], code);
        if (inner !== match[2]) translated = match[1] + inner + (match[3] || '');
      }
      if (translated == null) {
        const arrow = /^(.+?)(\s*[→↗])$/.exec(source);
        if (arrow) {
          const inner = lookup(arrow[1], code);
          if (inner !== arrow[1]) translated = inner + arrow[2];
        }
      }
    }
    if (translated == null) return source;
    // Preserve all-caps headings without maintaining a second dictionary.
    const letters = source.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 3 && letters === letters.toLocaleUpperCase('en')) {
      return translated.toLocaleUpperCase(code);
    }
    return translated;
  }

  function translate(input, code) {
    const value = String(input == null ? '' : input);
    if (!AVAILABLE[code || locale] || (code || locale) === 'en') return value;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    const source = normalize(match[2]);
    if (!source) return value;
    const result = lookup(source, code || locale);
    return result === source ? value : match[1] + result + match[3];
  }

  function template(input, variables, code) {
    let translated = translate(input, code);
    if (variables && typeof variables === 'object') {
      translated = translated.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match);
    }
    return translated;
  }

  function skip(node) {
    const parent = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(parent && parent.closest && parent.closest(IGNORE_SELECTOR));
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== 3 || skip(node)) return;
    const current = node.nodeValue;
    const previous = renderedText.get(node);
    const source = previous && current === previous.output ? previous.source : current;
    const result = translate(source);
    renderedText.set(node, { source: source, output: result });
    if (current !== result) node.nodeValue = result;
  }

  function translateAttribute(el, name) {
    // Never reinterpret live form values; only the label of a button-type input.
    if (name === 'value' && !el.matches('input[type="submit"], input[type="button"], input[type="reset"]')) return;
    if (skip(el) || !el.hasAttribute(name)) return;
    const current = el.getAttribute(name);
    const previousMap = renderedAttrs.get(el) || Object.create(null);
    const previous = previousMap[name];
    const source = previous && current === previous.output ? previous.source : current;
    const result = translate(source);
    previousMap[name] = { source: source, output: result };
    renderedAttrs.set(el, previousMap);
    if (result !== current) el.setAttribute(name, result);
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1 || skip(el)) return;
    for (const name of TRANSLATED_ATTRS) translateAttribute(el, name);
    if (el.matches('input[type="submit"], input[type="button"], input[type="reset"]')) {
      translateAttribute(el, 'value');
    }
  }

  function translateTree(rootNode) {
    if (!rootNode || skip(rootNode)) return;
    if (rootNode.nodeType === 3) { translateTextNode(rootNode); return; }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9) return;
    if (rootNode.nodeType === 1) translateElement(rootNode);
    const doc = root.document;
    if (!doc || !doc.createTreeWalker) return;
    const walker = doc.createTreeWalker(rootNode, 1 | 4); // ELEMENT_NODE | TEXT_NODE
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 3) translateTextNode(node);
      else translateElement(node);
    }
  }

  // Place language selection beside Appearance inside the existing hamburger drawer.
  // The developer console has no drawer, so use a compact topbar Preferences menu.
  function renderControl() {
    const doc = root.document;
    if (!doc || !doc.body || doc.getElementById('motivo-language-control')) return;

    const menu = typeof doc.querySelector === 'function'
      ? doc.querySelector('#motivo-side-menu, .motivo-universal-menu') : null;
    let host = menu;
    if (!host) {
      const details = doc.createElement('details');
      details.className = 'motivo-preferences-popover';
      const summary = doc.createElement('summary');
      summary.textContent = '⚙ Preferences';
      summary.setAttribute('data-i18n-ignore', '');
      details.appendChild(summary);
      const topbar = typeof doc.querySelector === 'function'
        ? doc.querySelector('.top-actions') : null;
      (topbar || doc.body).appendChild(details);
      host = details;
    }

    const container = doc.createElement('div');
    container.id = 'motivo-language-control';
    container.className = 'motivo-language-control';
    container.setAttribute('data-i18n-ignore', '');
    const label = doc.createElement('label');
    label.htmlFor = 'motivo-language-select';
    const select = doc.createElement('select');
    select.id = 'motivo-language-select';
    const automatic = doc.createElement('option');
    automatic.value = 'auto';
    select.appendChild(automatic);
    for (const [code, info] of Object.entries(AVAILABLE)) {
      const option = doc.createElement('option');
      option.value = code;
      option.textContent = info.nativeName;
      select.appendChild(option);
    }
    select.value = preference;
    select.addEventListener('change', () => setLanguage(select.value));
    container.appendChild(label);
    container.appendChild(select);

    const themeButton = menu && typeof menu.querySelector === 'function'
      ? menu.querySelector('.motivo-menu-theme') : null;
    if (themeButton && typeof menu.insertBefore === 'function') {
      menu.insertBefore(container, themeButton);
      const heading = doc.createElement('div');
      heading.className = 'motivo-preference-heading';
      heading.setAttribute('data-i18n-ignore', '');
      heading.textContent = 'Appearance';
      menu.insertBefore(heading, themeButton);
    } else {
      host.appendChild(container);
    }
    updateControl();
  }

  function updateControl() {
    const doc = root.document;
    if (!doc) return;
    const spanish = locale === 'es';
    const label = doc.getElementById('motivo-language-control')?.querySelector('label');
    const select = doc.getElementById('motivo-language-select');
    if (label) label.textContent = spanish ? '🌐 Idioma' : '🌐 Language';
    if (select) {
      select.value = preference;
      select.setAttribute('aria-label', spanish ? 'Seleccionar idioma' : 'Select language');
      const option = select.querySelector('option[value="auto"]');
      if (option) option.textContent = (spanish ? 'Automático (dispositivo)' : 'Auto (device)') +
        ' · ' + (browserLanguage() === 'es' ? 'Español' : 'English');
    }
    const heading = typeof doc.querySelector === 'function'
      ? doc.querySelector('.motivo-preference-heading') : null;
    if (heading) heading.textContent = spanish ? 'Apariencia' : 'Appearance';
    const prefs = typeof doc.querySelector === 'function'
      ? doc.querySelector('.motivo-preferences-popover > summary') : null;
    if (prefs) prefs.textContent = spanish ? '⚙ Preferencias' : '⚙ Preferences';
    const notice = doc.getElementById('motivo-legal-language-note');
    if (notice) notice.hidden = locale !== 'es';
  }

  function addLegalNotice() {
    const doc = root.document;
    if (!doc || !doc.body || !/\/(?:notice(?:\.html)?)$/i.test(root.location?.pathname || '')) return;
    if (doc.getElementById('motivo-legal-language-note')) return;
    const banner = doc.createElement('div');
    banner.id = 'motivo-legal-language-note';
    banner.className = 'motivo-legal-language-note';
    banner.setAttribute('data-i18n-ignore', '');
    banner.setAttribute('role', 'note');
    banner.textContent = 'Aviso: el texto legal completo está disponible actualmente solo en inglés. Las etiquetas de navegación traducidas no constituyen una traducción legal.';
    banner.hidden = locale !== 'es';
    doc.body.insertBefore(banner, doc.body.firstChild);
  }

  function setLanguage(next, persist = true) {
    if (next !== 'auto' && !Object.prototype.hasOwnProperty.call(AVAILABLE, next)) return false;
    preference = next;
    locale = next === 'auto' ? browserLanguage() : next;
    if (persist) safeWrite(next);
    if (root.document) {
      root.document.documentElement.lang = locale;
      root.document.documentElement.dir = AVAILABLE[locale].dir;
      translateTree(root.document.documentElement);
      updateControl();
      if (typeof root.CustomEvent === 'function') {
        root.document.dispatchEvent(new root.CustomEvent('motivo:languagechange', { detail: { language: locale, preference }  }));
      }
    }
    return true;
  }

  function initialize() {
    const doc = root.document;
    if (!doc || !doc.body) return;
    doc.documentElement.lang = locale;
    doc.documentElement.dir = AVAILABLE[locale].dir;
    renderControl();
    addLegalNotice();
    translateTree(doc.documentElement);
    if (typeof root.MutationObserver === 'function') {
      const observer = new root.MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') translateTextNode(mutation.target);
          else if (mutation.type === 'attributes') translateAttribute(mutation.target, mutation.attributeName);
          else for (const node of mutation.addedNodes) translateTree(node);
        }
      });
      observer.observe(doc.documentElement, {
        childList: true, characterData: true, attributes: true, subtree: true,
        attributeFilter: [...TRANSLATED_ATTRS, 'value']
      });
    }
  }

  root.MotivoI18n = Object.freeze({
    t: template,
    translate: translate,
    setLanguage: setLanguage,
    getLanguage: () => locale,
    getPreference: () => preference,
    deviceLanguage: browserLanguage,
    supportedLanguages: () => Object.keys(AVAILABLE),
    formatNumber: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    formatCurrency: (n, currency = 'USD') => new Intl.NumberFormat(locale, {style: 'currency', currency}).format(n),
    formatDate: (date, opts) => new Intl.DateTimeFormat(locale, opts).format(date)
  });

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY) {
        const next = AVAILABLE[event.newValue] ? event.newValue : 'auto';
        if (next !== preference) setLanguage(next, false);
      }
    });
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('languagechange', () => {
      if (preference === 'auto') setLanguage('auto', false);
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize, {once: true});
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
