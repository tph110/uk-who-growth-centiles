// Applies a saved theme before first paint, so switching does not flash the
// wrong colours on load.
//
// This is a separate file rather than an inline script on purpose: the site
// ships a strict Content-Security-Policy with script-src 'self' and no
// 'unsafe-inline', so an inline script would be blocked. It must stay a
// blocking script in <head> — deferring it would reintroduce the flash.
(function () {
  try {
    var stored = localStorage.getItem('growth-centiles-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (error) {
    // Storage can be unavailable (private mode, blocked cookies). The system
    // preference then applies, which is the correct fallback.
  }
})();
