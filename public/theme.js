function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    return;
  }

  if (savedTheme === 'light') {
    document.body.classList.remove('dark-mode');
    return;
  }

  const systemPrefersDark =
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  document.body.classList.toggle(
    'dark-mode',
    systemPrefersDark
  );
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');

  const theme =
    document.body.classList.contains('dark-mode')
      ? 'dark'
      : 'light';

  localStorage.setItem('theme', theme);
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
    !event.target.closest('.header')
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