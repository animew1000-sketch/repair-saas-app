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
    !event.target.closest('.header, .motivo-universal-menu, .motivo-preferences-popover')
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
  stylesheet.href = '/i18n.css?v=4';
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

// Decorative scroll glow: separate from language and theme functionality.
(function bootstrapMotivoScrollGradient() {
  if (window.__motivoScrollGradientRequested) return;
  window.__motivoScrollGradientRequested = true;
  const script = document.createElement('script');
  script.src = '/scroll-gradient.js?v=4';
  document.head.appendChild(script);
})();
