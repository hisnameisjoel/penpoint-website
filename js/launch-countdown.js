/* =============================================================
   LAUNCH COUNTDOWN SYSTEM
   Manages three states across all pages:
     1. Pre-launch  → countdown timer + email signup form
     2. Post-launch → Buy button (Lemon Squeezy checkout)

   Config: set PENPOINT_LAUNCH_DATE before loading this script.
   ============================================================= */
(function () {
  'use strict';

  // Launch date: March 21, 2026 at midnight, local user time
  var LAUNCH_DATE = new Date('2026-03-21T00:00:00');
  var LS_STORE = 'penpointapp';
  var LS_CHECKOUT_URL = 'https://penpointapp.lemonsqueezy.com/checkout/buy/5576a809-44e7-4179-b5f6-69c145725060?embed=1';
  var SUBSCRIBE_URL = 'https://' + LS_STORE + '.lemonsqueezy.com/email-subscribe/external';

  // ── State detection ──────────────────────────────────────────
  function isLaunched() {
    return new Date() >= LAUNCH_DATE;
  }

  // ── Countdown math ───────────────────────────────────────────
  function getTimeRemaining() {
    var now = new Date();
    var diff = LAUNCH_DATE - now;
    if (diff <= 0) return null;

    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    var minutes = Math.floor((diff / (1000 * 60)) % 60);
    var seconds = Math.floor((diff / 1000) % 60);

    return { days: days, hours: hours, minutes: minutes, seconds: seconds, total: diff };
  }

  function padZero(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ── Build countdown + email signup HTML ──────────────────────
  function buildCountdownBlock(isHero) {
    var sizeClass = isHero ? 'launch-countdown--hero' : 'launch-countdown--compact';

    var html = '<div class="launch-countdown ' + sizeClass + '">';
    html += '<p class="launch-countdown__label font-heading">Launching March 21st</p>';

    // Countdown digits
    html += '<div class="launch-countdown__timer">';
    html += '<div class="launch-countdown__unit">';
    html += '<span class="launch-countdown__value" data-countdown-days>--</span>';
    html += '<span class="launch-countdown__unit-label font-body-sm">days</span>';
    html += '</div>';
    html += '<span class="launch-countdown__sep">:</span>';
    html += '<div class="launch-countdown__unit">';
    html += '<span class="launch-countdown__value" data-countdown-hours>--</span>';
    html += '<span class="launch-countdown__unit-label font-body-sm">hours</span>';
    html += '</div>';
    html += '<span class="launch-countdown__sep">:</span>';
    html += '<div class="launch-countdown__unit">';
    html += '<span class="launch-countdown__value" data-countdown-minutes>--</span>';
    html += '<span class="launch-countdown__unit-label font-body-sm">min</span>';
    html += '</div>';
    html += '<span class="launch-countdown__sep">:</span>';
    html += '<div class="launch-countdown__unit">';
    html += '<span class="launch-countdown__value" data-countdown-seconds>--</span>';
    html += '<span class="launch-countdown__unit-label font-body-sm">sec</span>';
    html += '</div>';
    html += '</div>';

    // Email signup form
    html += '<div class="launch-countdown__signup">';
    html += '<p class="launch-countdown__signup-label font-body-sm">Get notified when Penpoint launches:</p>';
    html += '<form class="launch-countdown__form" data-launch-form>';
    html += '<input type="email" name="email" placeholder="your@email.com" required class="launch-countdown__input font-body">';
    html += '<button type="submit" class="btn btn-primary launch-countdown__submit">';
    html += 'Notify Me';
    html += '</button>';
    html += '</form>';
    html += '<p class="launch-countdown__form-status font-body-sm" data-launch-form-status></p>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Build buy button HTML ────────────────────────────────────
  function buildBuyButton() {
    var cls = 'btn btn-primary btn-xl btn-shadow lemonsqueezy-button';
    return '<a href="' + LS_CHECKOUT_URL + '" class="' + cls + '">Buy Penpoint &mdash; $40</a>';
  }

  // ── Handle form submission via AJAX (per LS docs) ───────────
  function handleFormSubmit(form) {
    var statusEl = form.parentElement.querySelector('[data-launch-form-status]');
    var emailInput = form.querySelector('input[name="email"]');
    var submitBtn = form.querySelector('button[type="submit"]');
    var email = emailInput.value.trim();

    if (!email) return;

    // Disable form while submitting
    emailInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    statusEl.textContent = '';
    statusEl.className = 'launch-countdown__form-status font-body-sm';

    fetch(SUBSCRIBE_URL, {
      method: 'POST',
      body: new FormData(form)
    })
    .then(function (response) {
      if (!response.ok) throw new Error('Subscription failed.');
      form.style.display = 'none';
      statusEl.textContent = "You're on the list! We'll email you on launch day.";
      statusEl.className = 'launch-countdown__form-status launch-countdown__form-status--success font-body-sm';
    })
    .catch(function () {
      statusEl.textContent = 'Something went wrong. Try again or join our Discord for updates.';
      statusEl.className = 'launch-countdown__form-status launch-countdown__form-status--error font-body-sm';
      emailInput.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Notify Me';
    });
  }

  // ── Interval handle (so we can stop ticking after launch) ──
  var countdownInterval = null;

  // ── Update all countdown displays ───────────────────────────
  function updateCountdowns() {
    var remaining = getTimeRemaining();

    if (!remaining) {
      // Launch time reached! Stop ticking and swap to buy mode
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      swapToLaunchMode();
      return;
    }

    var daysEls = document.querySelectorAll('[data-countdown-days]');
    var hoursEls = document.querySelectorAll('[data-countdown-hours]');
    var minutesEls = document.querySelectorAll('[data-countdown-minutes]');
    var secondsEls = document.querySelectorAll('[data-countdown-seconds]');

    for (var i = 0; i < daysEls.length; i++) {
      daysEls[i].textContent = padZero(remaining.days);
    }
    for (var j = 0; j < hoursEls.length; j++) {
      hoursEls[j].textContent = padZero(remaining.hours);
    }
    for (var k = 0; k < minutesEls.length; k++) {
      minutesEls[k].textContent = padZero(remaining.minutes);
    }
    for (var l = 0; l < secondsEls.length; l++) {
      secondsEls[l].textContent = padZero(remaining.seconds);
    }
  }

  // ── Swap countdown blocks to buy buttons (live transition) ──
  function swapToLaunchMode() {
    var countdowns = document.querySelectorAll('.launch-countdown');
    countdowns.forEach(function (el) {
      el.outerHTML = buildBuyButton();
    });

    // Re-init Lemon Squeezy overlay if available
    if (window.createLemonSqueezy) {
      window.createLemonSqueezy();
    }

    // Update header nav button
    var headerBetaBtn = document.querySelector('.header__nav .launch-countdown-nav-btn');
    if (headerBetaBtn) {
      var buyLink = document.createElement('a');
      buyLink.href = LS_CHECKOUT_URL;
      buyLink.className = 'btn btn-primary lemonsqueezy-button';
      buyLink.textContent = 'Buy Penpoint';
      headerBetaBtn.replaceWith(buyLink);
    }

    // Update structured data
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    ldScripts.forEach(function (s) {
      if (s.textContent.indexOf('PreOrder') !== -1) {
        s.textContent = s.textContent
          .replace('"https://schema.org/PreOrder"', '"https://schema.org/InStock"')
          .replace('"price": 0', '"price": 40');
      }
    });
  }

  // ── Initialize everything ───────────────────────────────────
  function init() {
    if (isLaunched()) {
      // Already launched — show buy buttons as-is (default HTML)
      // Just make sure no countdown blocks exist
      return;
    }

    // ── Pre-launch mode ──

    // 1. Replace hero CTA buttons with countdown block
    var heroCtas = document.querySelectorAll('.hero__cta');
    heroCtas.forEach(function (cta) {
      cta.innerHTML = buildCountdownBlock(true);
    });

    // 2. Replace all .lemonsqueezy-button elements (except in hero)
    var lsButtons = document.querySelectorAll('.lemonsqueezy-button');
    lsButtons.forEach(function (btn) {
      // Skip if already inside a countdown block
      if (btn.closest('.launch-countdown')) return;

      // Header nav button → simple "Join Waitlist" that scrolls or shows info
      if (btn.closest('.header__nav')) {
        var waitlistBtn = document.createElement('a');
        waitlistBtn.href = '#download';
        waitlistBtn.className = 'btn btn-primary launch-countdown-nav-btn';
        waitlistBtn.textContent = 'Join the Waitlist';
        btn.replaceWith(waitlistBtn);
        return;
      }

      // Final CTA and other standalone buy buttons → compact countdown
      // For final CTA section, replace the button with a compact countdown
      if (btn.closest('.final-cta') || btn.closest('.purchase-cta') || btn.closest('.compare-cta')) {
        btn.outerHTML = buildCountdownBlock(false);
        return;
      }

      // Generic fallback — replace with compact countdown
      btn.outerHTML = buildCountdownBlock(false);
    });

    // 3. Update structured data to pre-order
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    ldScripts.forEach(function (s) {
      if (s.textContent.indexOf('InStock') !== -1) {
        s.textContent = s.textContent
          .replace('"https://schema.org/InStock"', '"https://schema.org/PreOrder"')
          .replace('"price": 40', '"price": 0');
      }
    });

    // 4. Bind form submissions
    var forms = document.querySelectorAll('[data-launch-form]');
    forms.forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        handleFormSubmit(form);
      });
    });

    // 5. Start countdown ticker
    updateCountdowns();
    countdownInterval = setInterval(updateCountdowns, 1000);
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
