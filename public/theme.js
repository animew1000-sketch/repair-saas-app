function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeMenuButtons();
    return;
  }

  if (savedTheme === 'light') {
    document.body.classList.remove('dark-mode');
    updateThemeMenuButtons();
    return;
  }

  const systemPrefersDark =
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  document.body.classList.toggle(
    'dark-mode',
    systemPrefersDark
  );

  updateThemeMenuButtons();
}

function updateThemeMenuButtons() {
  const nextLabel =
    document.body.classList.contains('dark-mode')
      ? 'Switch to light mode'
      : 'Switch to dark mode';

  document
    .querySelectorAll('.motivo-menu-theme')
    .forEach((button) => {
      button.setAttribute('aria-label', nextLabel);
      const label = button.querySelector('.motivo-menu-theme-label');
      if (label) {
        label.textContent = nextLabel;
      }
    });
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');

  const theme =
    document.body.classList.contains('dark-mode')
      ? 'dark'
      : 'light';

  localStorage.setItem('theme', theme);
  updateThemeMenuButtons();
}

function toggleMotivoMenu(toggle) {
  toggle = toggle || document.querySelector('.motivo-menu-toggle');

  const isOpen =
    document.body.classList.toggle('motivo-menu-open');

  toggle?.setAttribute('aria-expanded', String(isOpen));
  toggle?.setAttribute(
    'aria-label',
    isOpen ? 'Close navigation menu' : 'Open navigation menu'
  );
}

document.addEventListener('click', (event) => {
  if (
    document.body.classList.contains('motivo-menu-open') &&
    !event.target.closest('.header, .motivo-universal-menu, .motivo-preferences-popover, .motivo-menu-toggle')
  ) {
    document.body.classList.remove('motivo-menu-open');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.body.classList.remove('motivo-menu-open');
  }
});

applySavedTheme();
// Automatically close the sidebar after selecting a destination.
document.addEventListener('click', (event) => {
  const navigationLink = event.target.closest(
    '#motivo-side-menu .header-link'
  );

  if (!navigationLink) return;

  document.body.classList.remove('motivo-menu-open');

  const menuButton = document.querySelector('.motivo-menu-toggle');

  if (menuButton) {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation menu');
  }
});

// Language support is bootstrapped here because existing Motivo pages
// already load theme.js. Preserve all theme/menu behavior above.
(function bootstrapMotivoLanguage() {
  if (window.__motivoI18nBootstrapped) return;
  window.__motivoI18nBootstrapped = true;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/i18n.css?v=8';
  document.head.appendChild(stylesheet);

  const dictionary = document.createElement('script');
  dictionary.src = '/i18n/es.js?v=1';
  dictionary.async = false;
  dictionary.onload = function () {
    const framework = document.createElement('script');
    framework.src = '/i18n.js?v=4';
    framework.async = false;
    document.head.appendChild(framework);
  };
  dictionary.onerror = function () {
    console.warn('Motivo language dictionary unavailable; English UI retained.');
  };
  document.head.appendChild(dictionary);
})();

// Motivo v8: decorative gradients are pre-rendered; no scroll or pointer JS.

// Motivo shared wordmark: decorate legacy HTML headers without changing
// forms, account data, click handlers, or the existing navigation drawers.
(function unifyMotivoBrand() {
  function apply() {
    if (!document.body) return;
    const wordmark = '/images/Motivo-white-word-transparent.png';
    if (document.body.classList.contains('motivo-public-page')) {
      document.querySelectorAll('.header .brand').forEach(function (brand) {
        if (brand.querySelector('img')) return;
        const label = brand.textContent.trim();
        if (label.toLowerCase() !== 'motivo') return;
        brand.textContent = '';
        const logo = document.createElement('img');
        logo.src = wordmark;
        logo.alt = 'Motivo';
        logo.className = 'brand-logo';
        brand.appendChild(logo);
      });
    }
    if (!document.body.classList.contains('motivo-universal-page')) return;
    const header = document.querySelector('body > header');
    const left = header && header.querySelector(':scope > div:first-child');
    if (!left || left.querySelector('.motivo-unified-brand')) return;
    const link = document.createElement('a');
    link.href = '/';
    link.className = 'motivo-unified-brand';
    link.setAttribute('aria-label', 'Motivo home');
    const logo = document.createElement('img');
    logo.src = wordmark;
    logo.alt = 'Motivo';
    logo.decoding = 'async';
    link.appendChild(logo);
    left.insertBefore(link, left.firstChild);
    for (const sibling of Array.from(left.children)) {
      if (sibling === link) continue;
      if (sibling.tagName === 'SPAN' && /^(?:🚗|🚨|🔧|MOTIVO|MOTIVO CUSTOMER PORTAL)$/u.test(sibling.textContent.trim())) {
        sibling.classList.add('motivo-legacy-brand-hidden');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (sibling.tagName === 'DIV' && sibling.textContent.trim() === 'R' && sibling.classList.contains('bg-orange-500')) {
        sibling.classList.add('motivo-legacy-brand-hidden');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (sibling.tagName === 'DIV') {
        const caption = Array.from(sibling.children).find(function (el) {
          return /MOTIVO CUSTOMER PORTAL/i.test(el.textContent.trim()) && !el.id;
        });
        if (caption) caption.textContent = 'Customer Portal';
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, {once: true});
  else apply();
})();
