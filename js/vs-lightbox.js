/* ===========================================
   Comparison-page screenshot lightbox
   Shared by every /*-alternative.html page (and /compare).

   The [data-lb] dialog markup is injected here if a page does not already
   provide one, so there is one definition instead of one copy per page.
   This is JS-only enhancement: the <figure data-shot> elements and their
   <img> tags already exist in the raw HTML and remain plain inline images
   with JavaScript off. AI crawlers and no-JS browsers see the same content,
   just without the click-to-enlarge overlay.
   =========================================== */
(function () {
  function ensureDialog() {
    var lb = document.querySelector('[data-lb]');
    if (lb) return lb;

    lb = document.createElement('div');
    lb.className = 'vs-lb';
    lb.setAttribute('data-lb', '');
    lb.hidden = true;
    lb.innerHTML =
      '<div class="vs-lb__panel">' +
        '<div class="vs-lb__figure">' +
          '<img data-lb-img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="">' +
          '<button type="button" class="vs-lb__close" data-lb-close aria-label="Close">&times;</button>' +
        '</div>' +
        '<p class="vs-lb__cap" data-lb-cap></p>' +
      '</div>';
    document.body.appendChild(lb);
    return lb;
  }

  function init() {
    var shots = document.querySelectorAll('[data-shot]');
    if (!shots.length) return;

    var lb = ensureDialog();
    lb.hidden = false;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    var img = lb.querySelector('[data-lb-img]');
    var cap = lb.querySelector('[data-lb-cap]');
    var closeBtn = lb.querySelector('[data-lb-close]');
    var opener = null;

    function open(fig) {
      opener = fig;
      var inner = fig.querySelector('img');
      cap.textContent = fig.getAttribute('data-cap') || '';
      img.alt = inner ? inner.alt : '';
      // Preload so the panel never animates in around an empty frame.
      var pre = new Image();
      function reveal() {
        img.src = fig.getAttribute('data-full');
        lb.classList.add('lb-open');
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
      }
      pre.onload = reveal;
      pre.onerror = reveal;
      pre.src = fig.getAttribute('data-full');
      if (pre.complete) reveal();
    }

    function close() {
      lb.classList.remove('lb-open');
      document.body.style.overflow = '';
      if (opener && opener.focus) opener.focus();
      opener = null;
    }

    shots.forEach(function (fig) {
      fig.setAttribute('role', 'button');
      fig.setAttribute('tabindex', '0');
      var inner = fig.querySelector('img');
      fig.setAttribute('aria-label', 'Enlarge: ' + (inner ? inner.alt : 'screenshot'));
      fig.addEventListener('click', function () { open(fig); });
      fig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(fig); }
      });
    });

    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb.classList.contains('lb-open')) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
