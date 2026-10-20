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

// A single source of truth for menu visibility and accessibility state.
function setMotivoMenuOpen(isOpen, restoreFocus) {
  document.body.classList.toggle('motivo-menu-open', !!isOpen);
  document.querySelectorAll('.motivo-menu-toggle').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', String(!!isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  });
  if (isOpen) {
    const activeToggle = document.activeElement?.closest?.('.motivo-menu-toggle');
    if (activeToggle) window.__motivoLastMenuToggle = activeToggle;
    window.requestAnimationFrame(() => {
      const drawer = document.querySelector('#motivo-side-menu, .motivo-universal-menu');
      const items = drawer && Array.from(drawer.querySelectorAll('button, a, select, input')).filter(el =>
        !el.disabled && !el.classList.contains('hidden') && el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
      );
      const preferred = items?.find(el => el.classList.contains('motivo-drawer-close')) || items?.[0];
      preferred?.focus({ preventScroll: true });
    });
  }
  if (!isOpen && restoreFocus) {
    (window.__motivoLastMenuToggle || document.querySelector('.motivo-menu-toggle'))?.focus({ preventScroll: true });
  }
}

function toggleMotivoMenu(toggle) {
  setMotivoMenuOpen(!document.body.classList.contains('motivo-menu-open'));
}

// Keep the existing outside-click and Escape behavior, but also reset
// aria-expanded (previously it could stay true after the drawer closed).
document.addEventListener('click', (event) => {
  if (
    document.body.classList.contains('motivo-menu-open') &&
    !event.target.closest('.header, .motivo-universal-menu, .motivo-preferences-popover, .motivo-menu-toggle')
  ) {
    setMotivoMenuOpen(false);
  }
});

// Keep keyboard Tab focus inside the open drawer. Escape still closes it.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !document.body.classList.contains('motivo-menu-open')) return;
  const drawer = document.querySelector('#motivo-side-menu, .motivo-universal-menu');
  if (!drawer) return;
  const focusable = Array.from(drawer.querySelectorAll('a, button, input, select, textarea, [tabindex]')).filter(el =>
    !el.disabled && el.tabIndex >= 0 && !el.classList.contains('hidden') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' &&
    getComputedStyle(el).display !== 'none'
  );
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (!drawer.contains(document.activeElement)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('motivo-menu-open')) {
    setMotivoMenuOpen(false, true);
  }
});

applySavedTheme();
// Selecting a navigation destination closes the drawer without changing
// the application's existing button/link handlers.
document.addEventListener('click', (event) => {
  if (event.target.closest('#motivo-side-menu .header-link, .motivo-universal-menu > a')) {
    setMotivoMenuOpen(false);
  }
});

// Mobile gets an explicit in-drawer Close button and an outside-tap surface.
// Place the scrim in the same stacking context as its drawer; the main SPA
// header and older standalone portal header have different DOM structures.
(function enhanceMotivoMobileMenu() {
  function apply() {
    const drawer = document.querySelector('#motivo-side-menu, .motivo-universal-menu');
    if (!drawer || drawer.querySelector('.motivo-drawer-close')) return;
    const heading = drawer.querySelector('.motivo-drawer-heading');
    if (!heading) return;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'motivo-drawer-close';
    close.setAttribute('aria-label', 'Close navigation menu');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => setMotivoMenuOpen(false, true));
    heading.appendChild(close);

    const scrim = document.createElement('div');
    scrim.className = 'motivo-mobile-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    scrim.addEventListener('click', () => setMotivoMenuOpen(false, true));
    const scrimHost = drawer.id === 'motivo-side-menu' ? drawer.parentElement : document.body;
    scrimHost.insertBefore(scrim, drawer);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();

// Language support is bootstrapped here because existing Motivo pages
// already load theme.js. Preserve all theme/menu behavior above.
(function bootstrapMotivoLanguage() {
  if (window.__motivoI18nBootstrapped) return;
  window.__motivoI18nBootstrapped = true;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/i18n.css?v=15';
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
