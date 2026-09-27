/* State of the Pen editions switcher.
 *
 * Every edition is a complete static page (/state-of-the-pen/2026, /2027, ...),
 * and every tab in the editions row is a plain link to one. That is what search
 * engines and no-JS readers get: normal navigation between crawlable pages.
 *
 * With JavaScript, a tab click fetches the other edition's page and swaps its
 * <article id="sotp-edition"> (plus its <style data-edition-style> blocks) into
 * this one, then updates the address bar, title, and canonical so the URL always
 * matches what is on screen. Any failure falls back to ordinary navigation.
 */
(function () {
  'use strict';

  const ARTICLE_ID = 'sotp-edition';
  // The path of the edition on screen, so a Back/Forward that only changes the
  // #hash (an in-page anchor) does not refetch the same edition.
  let shownPath = window.location.pathname;

  function syncHead(doc) {
    document.title = doc.title;
    for (const sel of ['link[rel="canonical"]', 'meta[name="description"]']) {
      const mine = document.head.querySelector(sel);
      const theirs = doc.head.querySelector(sel);
      if (mine && theirs) mine.replaceWith(theirs.cloneNode(true));
    }
    document.head.querySelectorAll('style[data-edition-style]').forEach((s) => s.remove());
    doc.head.querySelectorAll('style[data-edition-style]').forEach((s) => {
      document.head.appendChild(document.importNode(s, true));
    });
  }

  async function loadEdition(url, { push }) {
    const current = document.getElementById(ARTICLE_ID);
    if (!current) { window.location.href = url; return; }
    current.classList.add('is-leaving');

    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const incoming = doc.getElementById(ARTICLE_ID);
    if (!incoming) throw new Error('no edition article in response');

    syncHead(doc);
    const next = document.importNode(incoming, true);
    current.replaceWith(next);

    // The page-load observer in scroll-animations.js never saw these elements,
    // so reveal them directly; the CSS keyframes still play the fade-up.
    next.querySelectorAll('[data-animate]').forEach((el) => el.classList.add('animate-in'));

    if (push) window.history.pushState({ sotp: true }, '', url);
    shownPath = new URL(url, window.location.href).pathname;
    next.scrollIntoView({ block: 'start' });

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', { page_path: new URL(url, window.location.href).pathname });
    }
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('.sotp-editions a[href]');
    if (!link) return;
    // Let modified clicks (new tab, new window) behave like normal links.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (link.getAttribute('aria-current') === 'page') return;
    loadEdition(link.href, { push: true }).catch(() => { window.location.href = link.href; });
  });

  window.addEventListener('popstate', () => {
    if (window.location.pathname === shownPath) return;
    loadEdition(window.location.href, { push: false }).catch(() => window.location.reload());
  });
})();
