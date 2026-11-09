// Runs synchronously in <head> before the first paint: applies the saved language direction and theme so
// Urdu users never see a flash of left-to-right layout. Kept in sync with core/settings.js and core/i18n.js.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('payroll.settings') || '{}');
    var de = document.documentElement;
    if (s.language === 'ur') {
      de.lang = 'ur';
      de.dir = 'rtl';
      var bs = document.getElementById('bs-css');
      if (bs) bs.setAttribute('href', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css');
    }
    var dark = s.theme === 'dark' || (s.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    de.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  } catch (e) { /* no saved settings yet */ }
})();
