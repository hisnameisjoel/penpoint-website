/* =====================================================================
   Penpoint trial gate ("Velvet Rope")
   The email form in front of the free-trial download. Mounted on BOTH
   penpoint.app/trial and penpoint.app/novel-november, so it is built once.

   How it works
     1. A visitor types an email. POST {API}/trial-signup emails them
        https://penpoint.app/trial?key=<token>.
     2. /trial reads ?key=, asks POST {API}/trial-unlock whether it is real,
        and only then reveals the download picker. The browser remembers the
        key (localStorage), so a return visit skips the form.

   The gate is a SPEED BUMP, never a wall. Any network error, any 5xx, and any
   429 whose scope is not "email" opens the download. On /trial that reveals
   the picker; on the Novel November page it sets sessionStorage
   pp_trial_open=1 and sends the visitor to /trial, which reveals the picker
   when it sees that flag. Nothing in the URL can bypass the gate.

   Server contract: supabase/mailroom/README.md, "Event trial gate".
   unsubscribe.html reuses this file for the API base, postJson and the unsubscribe rules.

   This file is also loaded by tests/trial-gate.test.mjs (in a Node vm), so
   everything above mount() is pure and touches no DOM at load time.
   ===================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PPTrialGate = api;
})(typeof window !== 'undefined' ? window : this, function (win) {
  'use strict';

  /* ---------- constants ---------- */

  // Overridable ONLY through window.PP_TRIAL_API, for local testing.
  var API_DEFAULT = 'https://zspuwkxvzyompyzfeshp.supabase.co/functions/v1';
  var CONSENT_VERSION = 'nn-2026-10-v1';
  var KEY_STORAGE = 'pp_trial_key';   // localStorage: a verified link key (return visits skip the form)
  var OPEN_FLAG = 'pp_trial_open';    // sessionStorage: the gate failed open, show the download
  // trial.html strips ?key= from the address bar in <head>, BEFORE Google Analytics runs, and parks the
  // key here (sessionStorage) and on window.PP_TRIAL_PENDING_KEY until the unlock check is done.
  var PENDING_KEY = 'pp_trial_pending_key';
  var RESEND_SECONDS = 60;
  var REQUEST_TIMEOUT_MS = 12000;
  var LEAVE_MS = 180;                 // fade-out before one panel replaces another
  // The event copy runs through November 30. Local midnight on December 1 flips it.
  var EVENT_END = new Date(2026, 11, 1);

  var COPY = {
    label: 'Email address',
    newsletter: 'Send me Penpoint news and writing tips. Unsubscribe anytime.',
    submit: 'Email me the download',
    sending: 'Sending…',
    // Website copy never speaks as "I" (Joel, 2026-10-02): status lines are neutral ("The download link
    // was sent to"). Only the EMAILS speak as Joel (docs/technical/WritingLikeJoel.md). "Me" on the button
    // and the checkbox is the VISITOR speaking, which is fine. The newsletter checkbox label above and the
    // small print under the form (smallPrintParts) are consent wording tied to CONSENT_VERSION: leave them alone.
    phoneIntro: 'Penpoint is a desktop app, so the download link will be emailed to you to open on your computer.',
    phoneSent: 'Open the email on your computer to download Penpoint.',
    sentTitle: 'Check your inbox!',
    sentLead: 'The download link was sent to ',
    wrongAddress: 'Wrong address? ',
    change: 'Change it',
    notGotIt: 'Didn\'t get it? Check your spam folder, or ',
    resent: 'Sent again. Check your inbox.',
    empty: 'Enter your email address.',
    invalid: 'That email address doesn\'t look right.',
    disposable: 'Please use an email address you check. Throwaway addresses can\'t get the link.',
    rate: 'The link was just sent. Check your inbox (and your spam folder, just in case).',
    rateMore: ' Still nothing? Email ',
    supportEmail: 'support@penpoint.app',
    badLink: 'That link didn\'t work. Enter your email to get a fresh one.',
    checking: 'Checking your link…',
    didYouMean: 'Did you mean ',
    returningTitle: 'Welcome back!',
    returningLead: 'Your download is ready.',
    returningGo: 'Go to the download',
    returningOther: 'Send a link to a different email',
    opening: 'Taking you to the download…'
  };

  /* ---------- pure logic ---------- */

  function apiBase() {
    var o = win && win.PP_TRIAL_API;
    var base = (typeof o === 'string' && /^https?:\/\//.test(o)) ? o : API_DEFAULT;
    return base.replace(/\/+$/, '');
  }

  // True before 2026-12-01 in the visitor's local time.
  function isEventWindow(now) {
    return (now || new Date()).getTime() < EVENT_END.getTime();
  }

  // The small print under the form. `lead` plus `link` is the whole visible sentence run.
  function smallPrintParts(now) {
    return {
      lead: isEventWindow(now)
        ? 'We\'ll email your download link and a few Novel November updates through December. Unsubscribe anytime. '
        : 'We\'ll email your download link. ',
      link: 'Privacy policy'
    };
  }

  function isPhone(ua, touchPoints, width) {
    var nav = (win && win.navigator) || {};
    if (ua == null) ua = nav.userAgent || '';
    if (touchPoints == null) touchPoints = nav.maxTouchPoints || 0;
    if (width == null) width = (win && win.innerWidth) || 9999;
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)
      || (touchPoints > 1 && width < 820);
  }

  // A light shape check so an obvious slip never costs a round trip. The server is the real validator.
  function isPlausibleEmail(email) {
    return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  // Damerau-Levenshtein (optimal string alignment): a swapped pair of letters counts as one slip.
  function typoDistance(a, b) {
    var i, j, d = [];
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 1; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  // Big free-mail providers. A near-miss of one of these is almost always a slip of the finger.
  var PROVIDERS = ['gmail', 'hotmail', 'yahoo', 'outlook', 'icloud', 'aol'];
  // Real domains that sit one letter from a provider (mail.com is a real service one letter from gmail.com).
  var REAL_NEIGHBORS = { 'mail.com': 1, 'email.com': 1, 'gmx.com': 1, 'live.com': 1, 'msn.com': 1, 'me.com': 1, 'ymail.com': 1, 'aim.com': 1 };
  // Endings nobody means to type after a provider name (.cm, .co and .om are real country endings, but not for gmail).
  var PROVIDER_TLD_SLIPS = { co: 1, con: 1, cm: 1, om: 1, cmo: 1, ocm: 1, vom: 1, xom: 1, comm: 1, coom: 1, cim: 1, cpm: 1, c0m: 1 };
  // Endings that are never real, whatever the domain.
  var ANY_TLD_SLIPS = { con: 1, cmo: 1, ocm: 1, vom: 1, xom: 1, comm: 1, coom: 1 };
  var COMCAST_SLIPS = { 'comcast.nt': 1, 'comcast.ne': 1, 'comcast.met': 1, 'comcast.nett': 1, 'comcast.com': 1, 'comcast.con': 1 };

  function suggestDomain(domain) {
    domain = String(domain || '').toLowerCase();
    if (REAL_NEIGHBORS[domain]) return null;
    if (COMCAST_SLIPS[domain]) return 'comcast.net';
    var m = /^([a-z0-9-]+)\.([a-z0-9]+)$/.exec(domain);   // two-part domains only, so yahoo.co.uk is left alone
    if (!m) return null;
    var label = m[1], tld = m[2];
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      if (label === p) return tld === 'com' ? null : (PROVIDER_TLD_SLIPS[tld] ? p + '.com' : null);
      if (p.length >= 5 && label.length >= 4 && (tld === 'com' || PROVIDER_TLD_SLIPS[tld]) && typoDistance(label, p) === 1) {
        return p + '.com';
      }
    }
    if (ANY_TLD_SLIPS[tld]) return label + '.com';
    return null;
  }

  // "name@gmial.com" -> "name@gmail.com". Null when the address looks fine.
  function suggestEmail(email) {
    email = String(email || '').trim();
    var at = email.lastIndexOf('@');
    if (at < 1) return null;
    var fixed = suggestDomain(email.slice(at + 1));
    return fixed ? email.slice(0, at + 1) + fixed : null;
  }

  function buildSignupBody(email, source, newsletterOptIn, honeypot) {
    return {
      email: String(email || '').trim(),
      source: source === 'novel-november' ? 'novel-november' : 'trial',
      newsletterOptIn: newsletterOptIn === true,
      consentVersion: CONSENT_VERSION,
      website: honeypot ? String(honeypot) : ''
    };
  }

  // Signup response -> what the page does next.
  //   sent | invalid | disposable | rate_email   the visitor's own problem, shown on the form
  //   open                                       OUR problem, so the gate steps aside (fail open)
  function mapSignupResponse(status, body, networkError) {
    if (networkError) return { kind: 'open', why: 'network' };
    var b = body && typeof body === 'object' ? body : {};
    if (status === 200) return b.ok === true ? { kind: 'sent' } : { kind: 'open', why: 'unexpected-200' };
    if (status === 400 && b.error === 'invalid_input') {
      // Only the email field is the visitor's to fix. A 400 on source, consentVersion, newsletterOptIn
      // or body means this page and the server disagree, which must never become a wall.
      if (b.field === 'email') return { kind: b.reason === 'disposable' ? 'disposable' : 'invalid' };
      return { kind: 'open', why: 'bad-field-' + b.field };
    }
    if (status === 429 && b.error === 'rate_limited') {
      return b.scope === 'email' ? { kind: 'rate_email' } : { kind: 'open', why: 'rate-' + b.scope };
    }
    return { kind: 'open', why: 'status-' + status };
  }

  // Unlock response -> ok (reveal), bad (show the form), open (fail open).
  function mapUnlockResponse(status, body, networkError) {
    if (networkError) return 'open';
    var b = body && typeof body === 'object' ? body : {};
    if (status === 200 && b.ok === true) return 'ok';
    if (status === 200 && b.ok === false) return 'bad';
    return 'open';
  }

  // On load: what does this page do first?
  //   /trial:           unlock (a ?key= is present) | reveal (remembered or fail-open flag) | form
  //   Novel November:   returning (remembered or fail-open flag) | form
  function decideInitialState(o) {
    var remembered = !!(o && (o.storedKey || o.openFlag));
    if (o && o.source === 'trial') {
      if (o.key) return 'unlock';
      return remembered ? 'reveal' : 'form';
    }
    return remembered ? 'returning' : 'form';
  }

  function looksLikeKey(key) {
    return typeof key === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(key);
  }

  // The unsubscribe page (unsubscribe.html) shares this file for the API base and the rules below.
  // A well-formed key is exactly 43 base64url characters; the server answers anything else with a 400.
  function isWellFormedKey(key) {
    return typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
  }

  // Unsubscribe response -> done | incomplete (the key itself is bad, so email support) | retry (our problem).
  function mapUnsubscribeResponse(status, body, networkError) {
    if (networkError) return 'retry';
    var b = body && typeof body === 'object' ? body : {};
    if (status === 200 && b.ok === true) return 'done';
    if (status === 400 && b.error === 'invalid_input' && (b.field === 'key' || b.field === 'body')) return 'incomplete';
    return 'retry';
  }

  // The same address with the key removed, as path + query + hash (what history.replaceState wants).
  function stripKeyFromUrl(href) {
    try {
      var u = new URL(href, 'https://penpoint.app');
      u.searchParams.delete('key');
      return u.pathname + u.search + u.hash;
    } catch (e) {
      return '/trial';
    }
  }

  function resendLabel(secondsLeft) {
    return secondsLeft > 0 ? 'send it again in ' + secondsLeft + 's' : 'send it again';
  }

  // The first "The link was just sent" stands alone. From the second one on, point at support.
  function rateLimitCopy(count) {
    return {
      text: COPY.rate,
      showSupport: count >= 2
    };
  }

  /* ---------- small DOM and storage helpers (browser only, called from mount) ---------- */

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === false || v == null) continue;
        el.setAttribute(k, v === true ? '' : v);
      }
    }
    if (kids) {
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c == null) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return el;
  }

  function reduceMotion() {
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Touching window.localStorage can itself throw (blocked cookies, some private modes).
  function readStore(kind, key) {
    try { return win[kind].getItem(key); } catch (e) { return null; }
  }
  function writeStore(kind, key, value) {
    try { win[kind].setItem(key, value); } catch (e) { /* the gate still works without memory */ }
  }

  function postJson(url, body) {
    return new Promise(function (resolve) {
      var finished = false;
      function finish(v) { if (!finished) { finished = true; resolve(v); } }
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctl) ctl.abort();
        finish({ networkError: true });
      }, REQUEST_TIMEOUT_MS);
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        return res.json().then(function (j) { return j; }, function () { return {}; }).then(function (json) {
          clearTimeout(timer);
          finish({ status: res.status, body: json });
        });
      }).catch(function () {
        clearTimeout(timer);
        finish({ networkError: true });
      });
    });
  }

  function toSignupResult(res) {
    return res.networkError ? mapSignupResponse(0, null, true) : mapSignupResponse(res.status, res.body);
  }

  /* ---------- the gate ---------- */

  // opts.source    "trial" | "novel-november" (falls back to the element's data-source)
  // opts.onReveal  (reason, instant) => void. /trial only: the gate is done, show the download.
  //                reason: "key" | "stored" | "failopen"; instant is true when nothing should animate.
  function mount(rootEl, opts) {
    if (!rootEl) return null;
    opts = opts || {};
    var source = opts.source || rootEl.getAttribute('data-source') || 'trial';
    var onReveal = typeof opts.onReveal === 'function' ? opts.onReveal : function () {};
    var phone = isPhone();
    var base = apiBase();
    var s = { email: '', ackTypo: '', rateCount: 0, timer: null, swapId: 0, busy: false };
    var uid = 0;

    rootEl.textContent = '';
    rootEl.classList.add('tg');
    var stage = h('div', { 'class': 'tg-stage' });
    rootEl.appendChild(stage);

    /* Replace the current panel with a new one: fade the old one out, then fade the new one in. */
    function show(panel, o) {
      o = o || {};
      if (s.timer) { clearInterval(s.timer); s.timer = null; }
      var mine = ++s.swapId;
      var old = stage.firstElementChild;
      function put() {
        if (mine !== s.swapId) return;
        stage.textContent = '';
        if (!old) panel.classList.add('tg-static');   // first paint: the card's own entrance is the fade
        stage.appendChild(panel);
        if (o.focus) {
          var target = panel.querySelector(o.focus);
          if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
        }
        if (o.after) o.after();
      }
      if (!old || reduceMotion()) { put(); return; }
      old.classList.add('tg-leave');
      setTimeout(put, LEAVE_MS);
    }

    function failOpen() {
      writeStore('sessionStorage', OPEN_FLAG, '1');
      if (source === 'trial') {
        onReveal('failopen', false);
        return;
      }
      show(h('div', { 'class': 'tg-panel tg-loading', role: 'status' }, [
        h('span', { 'class': 'tg-spinner', 'aria-hidden': 'true' }),
        h('p', { 'class': 'tg-lead' }, [COPY.opening])
      ]));
      setTimeout(function () { win.location.assign('/trial'); }, 500);
    }

    function post(email, optIn, honeypot) {
      return postJson(base + '/trial-signup', buildSignupBody(email, source, optIn, honeypot)).then(toSignupResult);
    }

    function linkSupport(parent) {
      parent.appendChild(document.createTextNode(COPY.rateMore));
      parent.appendChild(h('a', { href: 'mailto:' + COPY.supportEmail }, [COPY.supportEmail]));
      parent.appendChild(document.createTextNode('.'));
    }

    function rateNodes(count) {
      var c = rateLimitCopy(count);
      var span = h('span', null, [c.text]);
      if (c.showSupport) linkSupport(span);
      return [span];
    }

    /* A message under the field. It lives in a polite live region, so changes are announced. */
    function messenger(msgEl, inputEl) {
      return {
        set: function (kind, nodes, invalid) {
          msgEl.textContent = '';
          msgEl.appendChild(h('div', { 'class': 'tg-msg__in tg-msg--' + kind }, nodes));
          if (inputEl) {
            if (invalid) inputEl.setAttribute('aria-invalid', 'true'); else inputEl.removeAttribute('aria-invalid');
          }
        },
        clear: function () {
          var box = msgEl.firstElementChild;
          if (inputEl) inputEl.removeAttribute('aria-invalid');
          if (!box) return;
          if (reduceMotion()) { msgEl.textContent = ''; return; }
          box.classList.add('tg-leave');
          setTimeout(function () { if (msgEl.firstElementChild === box) msgEl.textContent = ''; }, 160);
        }
      };
    }

    /* ---- panel: the form ---- */
    function formPanel(o) {
      o = o || {};
      var id = 'tg' + (++uid);
      var form = h('form', { 'class': 'tg-panel tg-form', novalidate: true, 'aria-label': 'Get the download link' });
      if (phone) form.appendChild(h('p', { 'class': 'tg-phone' }, [COPY.phoneIntro]));

      var input = h('input', {
        type: 'email', id: id + '-email', name: 'email', 'class': 'tg-input',
        autocomplete: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'email',
        required: true, 'aria-describedby': id + '-msg'
      });
      input.value = o.prefill || '';
      var msgEl = h('div', { 'class': 'tg-msg', id: id + '-msg', role: 'status', 'aria-live': 'polite' });
      var msg = messenger(msgEl, input);

      var honeypot = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
      var trap = h('div', { 'class': 'tg-hp', 'aria-hidden': 'true' }, [h('label', null, ['Website', honeypot])]);

      var news = h('input', { type: 'checkbox', name: 'newsletter', id: id + '-news' });
      // "Unsubscribe anytime." starts its own line so "anytime." is never left alone on the second line
      // (Joel, 2026-10-02). The words, and so the label's text, are exactly COPY.newsletter (consent wording).
      var newsText = COPY.newsletter.split(/ (?=Unsubscribe anytime\.)/);
      var newsKids = newsText.length === 2 ? [newsText[0] + ' ', h('br'), newsText[1]] : [COPY.newsletter];
      var check = h('label', { 'class': 'tg-check', 'for': id + '-news' }, [news, h('span', null, newsKids)]);

      var submit = h('button', { type: 'submit', 'class': 'btn btn-primary btn-lg btn-shadow tg-submit' }, [COPY.submit]);

      var parts = smallPrintParts(new Date());
      var fine = h('p', { 'class': 'tg-fine' }, [parts.lead, h('a', { href: '/privacy' }, [parts.link])]);

      form.appendChild(h('label', { 'class': 'tg-label', 'for': id + '-email' }, [COPY.label]));
      form.appendChild(input);
      form.appendChild(msgEl);
      form.appendChild(trap);
      form.appendChild(check);
      form.appendChild(submit);
      form.appendChild(fine);

      if (o.notice) msg.set('note', [o.notice], false);

      input.addEventListener('input', function () { msg.clear(); });

      function setBusy(on) {
        s.busy = on;
        submit.disabled = on;
        submit.textContent = on ? COPY.sending : COPY.submit;
        if (on) form.setAttribute('aria-busy', 'true'); else form.removeAttribute('aria-busy');
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (s.busy) return;
        var email = input.value.trim();
        input.value = email;
        if (!email) { msg.set('error', [COPY.empty], true); input.focus(); return; }
        if (!isPlausibleEmail(email)) { msg.set('error', [COPY.invalid], true); input.focus(); return; }

        // A likely typo gets ONE question. Sending again, unchanged, sends it as typed.
        var fix = suggestEmail(email);
        if (fix && s.ackTypo !== email) {
          s.ackTypo = email;
          var fixBtn = h('button', { type: 'button', 'class': 'tg-fix' }, [fix]);
          fixBtn.addEventListener('click', function () {
            input.value = fix;
            msg.clear();
            input.focus();
            try { input.setSelectionRange(fix.length, fix.length); } catch (err) { /* email inputs refuse selection in some browsers */ }
          });
          msg.set('note', [COPY.didYouMean, fixBtn, '?'], false);
          input.focus();
          return;
        }

        msg.clear();
        setBusy(true);
        post(email, news.checked, honeypot.value).then(function (r) {
          setBusy(false);
          if (r.kind === 'sent') {
            s.email = email;
            s.rateCount = 0;
            showSent();
          } else if (r.kind === 'disposable') {
            msg.set('error', [COPY.disposable], true);
            input.focus();
          } else if (r.kind === 'invalid') {
            msg.set('error', [COPY.invalid], true);
            input.focus();
          } else if (r.kind === 'rate_email') {
            s.rateCount++;
            msg.set('note', rateNodes(s.rateCount), false);
          } else {
            failOpen();
          }
        });
      });

      return form;
    }

    function showForm(o) {
      o = o || {};
      show(formPanel(o), { focus: o.focus ? '.tg-input' : null });
    }

    /* ---- panel: sent ---- */
    function showSent() {
      var panel = h('div', { 'class': 'tg-panel tg-sent' });
      var title = h('h2', { 'class': 'tg-title', tabindex: '-1' }, [COPY.sentTitle]);
      var lead = h('p', { 'class': 'tg-lead' }, [COPY.sentLead, h('strong', { 'class': 'tg-addr' }, [s.email]), '.']);
      panel.appendChild(title);
      panel.appendChild(lead);
      if (phone) panel.appendChild(h('p', { 'class': 'tg-phone' }, [COPY.phoneSent]));

      var changeBtn = h('button', { type: 'button', 'class': 'tg-link' }, [COPY.change]);
      changeBtn.addEventListener('click', function () { showForm({ prefill: s.email, focus: true }); });
      panel.appendChild(h('p', { 'class': 'tg-aside' }, [COPY.wrongAddress, changeBtn]));

      var resendBtn = h('button', { type: 'button', 'class': 'tg-link', disabled: true }, [resendLabel(RESEND_SECONDS)]);
      panel.appendChild(h('p', { 'class': 'tg-aside' }, [COPY.notGotIt, resendBtn]));

      var msgEl = h('div', { 'class': 'tg-msg', role: 'status', 'aria-live': 'polite' });
      var msg = messenger(msgEl, null);
      panel.appendChild(msgEl);

      var left = RESEND_SECONDS;
      function startCountdown() {
        if (s.timer) clearInterval(s.timer);
        left = RESEND_SECONDS;
        resendBtn.disabled = true;
        resendBtn.textContent = resendLabel(left);
        s.timer = setInterval(function () {
          left--;
          resendBtn.textContent = resendLabel(left);
          if (left <= 0) {
            clearInterval(s.timer);
            s.timer = null;
            resendBtn.disabled = false;
          }
        }, 1000);
      }

      resendBtn.addEventListener('click', function () {
        if (resendBtn.disabled) return;
        resendBtn.disabled = true;
        resendBtn.textContent = COPY.sending;
        if (s.timer) { clearInterval(s.timer); s.timer = null; }
        msg.clear();
        post(s.email, false, '').then(function (r) {
          if (r.kind === 'sent') {
            s.rateCount = 0;
            msg.set('note', [COPY.resent], false);
            startCountdown();
          } else if (r.kind === 'rate_email') {
            s.rateCount++;
            msg.set('note', rateNodes(s.rateCount), false);
            startCountdown();
          } else if (r.kind === 'disposable' || r.kind === 'invalid') {
            showForm({ prefill: s.email, focus: true });
          } else {
            failOpen();
          }
        });
      });

      show(panel, { focus: '.tg-title', after: startCountdown });
    }

    /* ---- panel: loading and returning ---- */
    function loadingPanel(text) {
      return h('div', { 'class': 'tg-panel tg-loading', role: 'status' }, [
        h('span', { 'class': 'tg-spinner', 'aria-hidden': 'true' }),
        h('p', { 'class': 'tg-lead' }, [text])
      ]);
    }

    function returningPanel() {
      var other = h('button', { type: 'button', 'class': 'tg-link' }, [COPY.returningOther]);
      other.addEventListener('click', function () { showForm({ focus: true }); });
      return h('div', { 'class': 'tg-panel tg-return' }, [
        h('h2', { 'class': 'tg-title' }, [COPY.returningTitle]),
        h('p', { 'class': 'tg-lead' }, [COPY.returningLead]),
        h('a', { 'class': 'btn btn-primary btn-lg btn-shadow tg-go', href: '/trial' }, [COPY.returningGo]),
        h('p', { 'class': 'tg-aside' }, [other])
      ]);
    }

    /* ---- /trial: ask the server whether the ?key= is real ---- */

    // The key is read from the stash the <head> script left, else from the URL (a page without that script).
    function readKey() {
      var parked = readStore('sessionStorage', PENDING_KEY) || win.PP_TRIAL_PENDING_KEY;
      if (parked) return String(parked).trim();
      try { return (new URLSearchParams(win.location.search).get('key') || '').trim(); } catch (e) { return ''; }
    }

    // Done with the key, whatever the verdict: it must not linger in the address bar or in storage.
    function cleanUp() {
      try { win.sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* nothing to remove */ }
      try { delete win.PP_TRIAL_PENDING_KEY; } catch (e) { win.PP_TRIAL_PENDING_KEY = undefined; }
      try { win.history.replaceState(null, '', stripKeyFromUrl(win.location.href)); } catch (e) { /* not worth failing for */ }
    }

    function unlock(key) {
      if (!looksLikeKey(key)) {
        cleanUp();
        showForm({ notice: COPY.badLink });
        return;
      }
      postJson(base + '/trial-unlock', { key: key }).then(function (res) {
        var r = res.networkError ? mapUnlockResponse(0, null, true) : mapUnlockResponse(res.status, res.body);
        cleanUp();
        if (r === 'ok') {
          writeStore('localStorage', KEY_STORAGE, key);
          onReveal('key', false);
        } else if (r === 'bad') {
          showForm({ notice: COPY.badLink });
        } else {
          failOpen();
        }
      });
    }

    var key = source === 'trial' ? readKey() : '';
    var initial = decideInitialState({
      source: source,
      key: key,
      storedKey: readStore('localStorage', KEY_STORAGE),
      openFlag: readStore('sessionStorage', OPEN_FLAG)
    });

    if (initial === 'reveal') {
      onReveal('stored', true);
    } else if (initial === 'returning') {
      show(returningPanel());
    } else if (initial === 'unlock') {
      show(loadingPanel(COPY.checking));
      unlock(key);
    } else {
      showForm();
    }
    return { source: source };
  }

  return {
    mount: mount,
    isPhone: isPhone,
    isEventWindow: isEventWindow,
    smallPrintParts: smallPrintParts,
    isPlausibleEmail: isPlausibleEmail,
    suggestEmail: suggestEmail,
    buildSignupBody: buildSignupBody,
    mapSignupResponse: mapSignupResponse,
    mapUnlockResponse: mapUnlockResponse,
    decideInitialState: decideInitialState,
    looksLikeKey: looksLikeKey,
    isWellFormedKey: isWellFormedKey,
    mapUnsubscribeResponse: mapUnsubscribeResponse,
    stripKeyFromUrl: stripKeyFromUrl,
    resendLabel: resendLabel,
    rateLimitCopy: rateLimitCopy,
    apiBase: apiBase,
    postJson: postJson,
    COPY: COPY,
    CONSENT_VERSION: CONSENT_VERSION,
    KEY_STORAGE: KEY_STORAGE,
    OPEN_FLAG: OPEN_FLAG,
    PENDING_KEY: PENDING_KEY,
    RESEND_SECONDS: RESEND_SECONDS
  };
});
