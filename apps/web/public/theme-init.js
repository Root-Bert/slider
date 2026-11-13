// The theme before the first paint (mirrors `installTheme` in src/lib/theme.ts): the stored
// choice ("light" | "system" | "dark", JSON under `slider.theme`), the system's by default.
(function () {
  var pref = 'system';
  try {
    var stored = JSON.parse(localStorage.getItem('slider.theme') || 'null');
    if (stored === 'light' || stored === 'dark') pref = stored;
  } catch {
    // No storage (private mode, blocked): the default stays.
  }
  var light =
    pref === 'light' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();
