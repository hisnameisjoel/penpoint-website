/* Penpoint shared site chrome — mobile nav (hamburger) toggle.
   Works on any page that includes the shared header markup
   ([data-burger] button + [data-mobile-menu] panel). */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  // Mark the nav link for the page you are on (aria-current="page", styled in site-chrome.css).
  // Pages inside a nav section keep that section lit: every /help/ page is Help, the *-alternative
  // pages are Compare, and Roadmap, Changelog and State of the Pen are Development.
  // Pages that do not load this file (home, about, buy, cloud...) carry the attribute in their own markup.
  var SECTIONS = [
    [/^\/help(\/|$)/, '/help'],
    [/-alternative$/, '/compare'],
    [/^\/(roadmap|changelog|state-of-the-pen)(\/|$)/, '/development']
  ];
  ready(function () {
    function clean(p) {
      return p.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    }
    var path = clean(location.pathname);
    var here = path;
    SECTIONS.some(function (s) {
      if (s[0].test(path)) { here = s[1]; return true; }
      return false;
    });
    document.querySelectorAll('.pp-nav a[href^="/"], .pp-mobile a[href^="/"]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href.indexOf('#') !== -1 || a.classList.contains('pp-cta')) return;
      if (clean(href) === here) a.setAttribute('aria-current', 'page');
    });
  });
  ready(function () {
    var burger = document.querySelector('[data-burger]');
    var panel = document.querySelector('[data-mobile-menu]');
    if (!burger || !panel) return;
    function setOpen(open) {
      burger.classList.toggle('open', open);
      panel.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    burger.addEventListener('click', function () {
      setOpen(!panel.classList.contains('open'));
    });
    panel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
  });
})();
