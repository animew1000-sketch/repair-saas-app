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

applySavedTheme();