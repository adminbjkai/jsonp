// Applies the saved (or system) theme before first paint so the page never flashes the wrong one.
(function () {
  var theme = 'dark';
  try {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem('jsonp.theme'));
    } catch (e) {
      /* An unreadable value is treated as no choice. */
    }
    theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
  } catch (e) {
    /* matchMedia or storage can be blocked; the default dark theme applies. */
  }
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute('content', theme === 'light' ? '#edf0f5' : '#0d1119');
})();
