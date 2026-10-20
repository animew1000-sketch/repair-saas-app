/* Motivo developer console: view preference only. No platform API changes. */
(function () {
  'use strict';
  const key = 'motivo.developer.console.display.v15';
  const root = document.documentElement;
  let saved = 'auto';
  try {
    const value = localStorage.getItem(key);
    if (value === 'dark' || value === 'light') saved = value;
  } catch (_) { /* Privacy mode may deny storage. */ }

  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const resolved = () => saved === 'auto' ? (system.matches ? 'dark' : 'light') : saved;
  const paint = () => { root.dataset.consoleTheme = resolved(); };
  paint();

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('consoleThemeSelect');
    if (!select) return;
    select.value = saved;
    select.addEventListener('change', () => {
      if (!['auto', 'dark', 'light'].includes(select.value)) return;
      saved = select.value;
      try { localStorage.setItem(key, saved); } catch (_) { /* Keep change for this session. */ }
      paint();
    });
  }, { once: true });

  if (typeof system.addEventListener === 'function') system.addEventListener('change', () => {
    if (saved === 'auto') paint();
  });
})();
