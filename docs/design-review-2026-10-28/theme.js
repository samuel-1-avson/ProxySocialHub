(function () {
  'use strict';
  const key = 'proxyhubb-concept-theme';
  const allowed = ['system', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { const saved = localStorage.getItem(key); if (allowed.includes(saved)) preference = saved; } catch (_) {}
  function apply() {
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelectorAll('[data-theme-choice]').forEach(select => { select.value = preference; });
  }
  window.ProxyTheme = {
    get: () => preference,
    set(value) {
      if (!allowed.includes(value)) return;
      preference = value;
      try { localStorage.setItem(key, value); } catch (_) {}
      apply();
    },
    apply,
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('change', event => {
    if (event.target.matches('[data-theme-choice]')) window.ProxyTheme.set(event.target.value);
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key) { preference = allowed.includes(event.newValue) ? event.newValue : 'system'; apply(); }
  });
})();
