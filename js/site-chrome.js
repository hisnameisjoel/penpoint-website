/* Penpoint shared site chrome — mobile nav (hamburger) toggle.
   Works on any page that includes the shared header markup
   ([data-burger] button + [data-mobile-menu] panel). */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
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
