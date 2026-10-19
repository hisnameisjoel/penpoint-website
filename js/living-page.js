/* Living Page: plays the home page hero (see css/living-page.css).
   A writer drafts Chapter 5 of the Sherlock Holmes demo book: @ brings in Inspector Lestrade, Scotland Yard
   and the Bruce-Partington plans, each one's card opens in the Minipen, Holmes's arc draws itself, then
   Flowstate turns on. Loops, pauses while the hero is off screen, and is a still frame for reduced motion. */
(function () {
  var frame = document.querySelector('[data-lp-frame]');
  if (!frame) return;
  var stage = frame.querySelector('[data-lp-stage]');
  var ICONS = 'images/living-page/icons.svg#';
  function $(s) { return stage.querySelector(s); }
  var page = $('[data-page]'), scrollEl = $('[data-scroll]'), prose = $('[data-prose]'), pick = $('[data-pick]');
  var mini = $('[data-mini]'), web = $('[data-web]'), flow = $('[data-flow]');
  var wordsEl = $('[data-words]'), totalEl = $('[data-total]'), cap = document.querySelector('[data-lp-cap]');
  var savedIc = $('[data-saved-ic] use'), savedT = $('[data-saved-t]');
  var figure = frame.closest('figure');

  /* ---------- fit: the whole desktop window, scaled to the frame's width ---------- */
  var scale = 1;
  var fitW = -1;
  function fit() {
    // Only a width change moves anything (phones fire resize whenever the address bar slides in or out mid-scroll).
    var w = frame.clientWidth;
    if (w === fitW) return;
    fitW = w;
    scale = w / 1280;
    stage.style.setProperty('--lp-s', scale);
    frame.style.height = (Math.round(800 * scale) + 2) + 'px'; // border-box: the stage plus the 1px border top and bottom
  }
  fit();
  window.addEventListener('resize', fit);
  // Also catches resizes that never fire window.resize. fit() runs a frame later because it sets the
  // frame's height, and doing that inside the observer callback would trip the "ResizeObserver loop" error.
  if ('ResizeObserver' in window) new ResizeObserver(function () { requestAnimationFrame(fit); }).observe(frame);

  /* ---------- the header clock shows the visitor's own time, like the app's ---------- */
  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('[data-clock]').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }
  tick(); setInterval(tick, 20000);

  /* ---------- timing: every step waits through gate(), which holds while the hero is off screen ---------- */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var instant = false, paused = false, waiters = [];
  function setPaused(p) {
    paused = p;
    frame.classList.toggle('lp-off', p); // freezes the window's CSS animations while it is off screen (living-page.css)
    if (!p) { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); }
  }
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { setPaused(!es[0].isIntersecting || document.hidden); }).observe(frame);
  document.addEventListener('visibilitychange', function () { setPaused(document.hidden); });
  function wait(ms) {
    if (instant) return Promise.resolve();
    return new Promise(function (r) { setTimeout(r, ms); }).then(function () {
      return paused ? new Promise(function (r) { waiters.push(r); }) : null;
    });
  }
  function rel(el) { // an element's box in stage pixels; a wrapped inline uses its last line
    var rs = el.getClientRects(), a = rs.length > 1 ? rs[rs.length - 1] : el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: (a.left - s.left) / scale, y: (a.top - s.top) / scale, w: a.width / scale, h: a.height / scale };
  }
  function setCap(t) {
    cap.style.opacity = 0;
    setTimeout(function () { cap.textContent = t; cap.style.opacity = 1; }, instant ? 0 : 380);
  }

  /* ---------- typing ---------- */
  var caret = document.createElement('span'); caret.className = 'lp-caret';
  var live, words = 435, total = 7191, saveTimer, off = 0;
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function bump(n) { words += n; total += n; wordsEl.textContent = words; totalEl.textContent = fmt(total); }
  function saving() {
    clearTimeout(saveTimer);
    savedIc.setAttribute('href', ICONS + 'refresh-cw'); savedT.textContent = 'Saving...';
    saveTimer = setTimeout(function () { savedIc.setAttribute('href', ICONS + 'check'); savedT.textContent = 'Saved'; }, 900);
  }
  function follow() { // scroll the page so the caret stays above the bottom edge
    var y = caret.offsetTop + caret.offsetHeight - off; // offsetTop is measured inside .pa-scroll (position:relative)
    var limit = page.clientHeight - 36;
    if (y > limit) { off += y - limit + 40; scrollEl.style.transform = 'translateY(' + (-off) + 'px)'; }
  }
  function newPara(cls) {
    live = document.createElement('p'); if (cls) live.className = cls;
    prose.appendChild(live); live.appendChild(caret); follow();
  }
  async function type(text, el) {
    el = el || document.createElement('span');
    if (!el.parentNode) live.insertBefore(el, caret);
    if (instant) { el.textContent += text; bump(text.split(' ').length - 1); return el; }
    stage.classList.add('lp-typing'); saving();
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      el.textContent += ch;
      if (ch === ' ' && i > 0 && text[i - 1] !== ' ') { bump(1); follow(); saving(); }
      var d = 28 + Math.random() * 42;
      if (',.;'.indexOf(ch) !== -1) d += 200;
      await wait(d);
    }
    stage.classList.remove('lp-typing'); follow();
    return el;
  }

  /* ---------- the @ picker: opens above the line, best match next to the caret, like the app ---------- */
  function icon(id, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="' + ICONS + id + '"/></svg>'; }
  function renderPick(rows, q) {
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
    pick.innerHTML = '<div class="ls">' + rows.map(function (r, i) {
      return '<div class="r' + (i === rows.length - 1 ? ' on' : '') + '">' + icon(r[2], r[3]) +
        '<div style="min-width:0"><div class="nm trunc">' + r[0].replace(re, '<b>$1</b>') + '</div><div class="st trunc">' + r[1] + '</div></div></div>';
    }).join('') + '</div><div class="ft"><span>' + icon('chevron-up') + icon('chevron-down') + 'Navigate</span><span>' + icon('corner-down-left') + 'Enter or Tab</span><span>Esc to close</span></div>';
  }
  function placePick(anchor) {
    var r = rel(anchor), p = rel(page), w = page.clientWidth;
    var left = Math.max(8, Math.min(r.x - p.x, w - 312));
    var top = r.y - p.y - pick.offsetHeight - 8;
    if (top < 8) top = r.y - p.y + r.h + 8;
    pick.style.left = left + 'px'; pick.style.top = top + 'px';
  }
  async function mention(query, rows, insert) {
    var q = await type('@');
    for (var i = 0; i < query.length; i++) {
      q.textContent += query[i];
      renderPick(rows, q.textContent.slice(1));
      if (i === 0) { placePick(q); if (!instant) pick.classList.add('show'); }
      await wait(110);
    }
    await wait(650);
    pick.classList.remove('show');
    var ins = document.createElement('span'); ins.className = 'lp-ins' + (instant ? '' : ' flash'); ins.textContent = insert;
    live.replaceChild(ins, q);
    setTimeout(function () { ins.classList.remove('flash'); }, 80);
    bump(insert.split(' ').length);
    saving(); follow();
    return ins;
  }

  /* ---------- Minipen ---------- */
  var current = 'list';
  function tab(name) { stage.querySelectorAll('.pm-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === name); }); }
  function show(view) {
    var from = mini.querySelector('[data-view="' + current + '"]'), to = mini.querySelector('[data-view="' + view + '"]');
    if (from !== to) { from.classList.remove('on'); from.classList.add('out'); setTimeout(function () { from.classList.remove('out'); }, 300); }
    to.classList.remove('pm-play'); void to.offsetWidth;
    to.querySelectorAll('.pm-c').forEach(function (c, i) { c.style.animationDelay = (instant ? 0 : 60 + i * 45) + 'ms'; });
    to.classList.add('on'); if (!instant) to.classList.add('pm-play');
    var inner = to.querySelector('.pm-in');
    if (inner) { inner.style.transition = 'none'; inner.style.transform = ''; void inner.offsetWidth; inner.style.transition = ''; }
    current = view;
    return to;
  }
  function scrollCard(view, toSel) {
    var inner = view.querySelector('.pm-in'), target = view.querySelector(toSel);
    if (!inner || !target) return;
    var room = view.querySelector('.pm-sc').clientHeight;
    var y = Math.min(target.offsetTop - 6, inner.scrollHeight - room);
    if (y > 0) inner.style.transform = 'translateY(' + (-y) + 'px)';
  }

  /* ---------- Story Web: route under the paragraph, out past the editor, then up into the card ---------- */
  var webTimer;
  function clearWeb() { clearTimeout(webTimer); web.innerHTML = ''; }
  function drawWeb(word, view) {
    if (instant) return;
    var anchor = view.querySelector('[data-anchor]'); if (!anchor) return;
    var a = rel(word), b = rel(anchor), lv = rel(live), cv = rel(page);
    var x1 = a.x + Math.min(a.w / 2, 40), y1 = a.y + a.h + 3, x2 = b.x - 10, y2 = b.y + b.h / 2;
    var yb = Math.min(lv.y + lv.h + 22, cv.y + cv.h - 20), xe = cv.x + cv.w;
    var d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (yb - 4) + ' ' + x1 + ',' + yb + ' ' + (x1 + 28) + ',' + yb +
      ' L' + (xe - 40) + ',' + yb + ' C' + (xe + 12) + ',' + yb + ' ' + (x2 - 40) + ',' + y2 + ' ' + x2 + ',' + y2;
    clearWeb();
    web.innerHTML = '<path d="' + d + '"/><circle cx="' + x1 + '" cy="' + y1 + '" r="3"/><circle cx="' + x2 + '" cy="' + y2 + '" r="3"/>';
    var path = web.querySelector('path'), len = path.getTotalLength();
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len; path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset .7s cubic-bezier(.4,0,.2,1), opacity .7s ease';
    path.style.strokeDashoffset = 0;
    webTimer = setTimeout(function () { web.querySelectorAll('path,circle').forEach(function (n) { n.style.opacity = 0; }); }, 1900);
  }

  /* ---------- Holmes's fortune curve: Catmull-Rom through the keyframes, as on the Arc page ---------- */
  function buildCurve() {
    var box = $('[data-curve]'), W = box.clientWidth, H = box.clientHeight;
    var ys = [-1, 0, 4, 5, 4, 8], mx = 22, my = 16, lo = -1, hi = 8;
    var pts = ys.map(function (y, i) { return [mx + i * (W - 2 * mx) / (ys.length - 1), my + (hi - y) * (H - 2 * my) / (hi - lo)]; });
    var d = 'M' + pts[0][0] + ',' + pts[0][1], t = 0.3 / 1.8;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) * t) + ',' + (p1[1] + (p2[1] - p0[1]) * t) + ' ' +
        (p2[0] - (p3[0] - p1[0]) * t) + ',' + (p2[1] - (p3[1] - p1[1]) * t) + ' ' + p2[0] + ',' + p2[1];
    }
    var zero = my + hi * (H - 2 * my) / (hi - lo);
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '"><line class="bl" x1="0" x2="' + W + '" y1="' + zero + '" y2="' + zero + '"/><path class="ln" d="' + d + '"/>' +
      pts.map(function (p) { return '<path class="dm" d="M' + p[0] + ',' + (p[1] - 9.8) + ' l7,9.8 l-7,9.8 l-7,-9.8 z"/>'; }).join('') + '</svg>';
    var ln = box.querySelector('.ln'), len = ln.getTotalLength();
    ln.style.strokeDasharray = len; ln.style.strokeDashoffset = instant ? 0 : len;
    return { ln: ln, dms: box.querySelectorAll('.dm') };
  }
  async function drawCurve() {
    var c = buildCurve();
    if (instant) { c.dms.forEach(function (d) { d.classList.add('in'); }); return c; }
    await wait(300);
    c.ln.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)'; c.ln.style.strokeDashoffset = 0;
    for (var i = 0; i < c.dms.length; i++) { await wait(150); c.dms[i].classList.add('in'); }
    return c;
  }
  function selectKf(c, n) {
    stage.querySelectorAll('.pa-kr').forEach(function (r, i) { r.classList.toggle('on', i === n); });
    c.dms.forEach(function (d, i) { d.classList.toggle('sel', i === n); });
  }

  /* ---------- Flowstate ---------- */
  var timerIv;
  function flowOn() {
    flow.classList.add('on'); $('[data-flow-t]').textContent = 'Write'; stage.classList.add('lp-fs');
    var s = 900; $('[data-timer]').textContent = '15:00';
    timerIv = setInterval(function () { if (paused) return; s--; $('[data-timer]').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }, 1000);
  }
  function flowOff() {
    clearInterval(timerIv); flow.classList.remove('on'); $('[data-flow-t]').textContent = 'Flowstate'; stage.classList.remove('lp-fs');
    prose.querySelectorAll('.lock').forEach(function (s) { s.classList.remove('lock'); });
  }

  /* ---------- the story ---------- */
  // Picker rows, best match last (it sits next to the caret): [name, subtitle, icon, icon class]
  var CHAR = [['Lestrade’s Office', 'Location • Secondary', 'briefcase', 'ic-f'], ['Lestrade’s Gambit', 'Story Arc • Subplot', 'spline', 'rot'], ['Lestrade', 'Character • aka Inspector Lestrade', 'user']];
  var LOC = [['Scotland Yard Badge', 'Item • Personal Effects', 'gem'], ['Scotland Yard', 'Location • Primary', 'landmark', 'ic-f']];
  var ITEM = [['5. The Bruce-Partington Plans', 'Chapter', 'book-open'], ['Bruce-Partington Submarine Plans', 'Item • Documents', 'scroll-text']];

  async function beatCharacter() {
    await type('It was ');
    var w = await mention('Lest', CHAR, 'Lestrade');
    // Pick him out of the list first, and hold there long enough to read, before his card opens.
    var row = mini.querySelector('[data-row="lestrade"]');
    row.classList.add('hot'); await wait(1200); row.classList.remove('hot');
    tab('char'); var v = show('lestrade'); setCap('Type @ and your characters are right there');
    await wait(260); drawWeb(w, v);
    await type(', grim as the fog itself, who climbed our stair that evening. ');
    if (!instant) scrollCard(v, '[data-scroll-to]'); // the still frame keeps the portrait in view
    await wait(900);
  }
  async function beatPlace() {
    await type('He had come straight from ');
    var w = await mention('Scot', LOC, 'Scotland Yard');
    tab('loc'); var v = show('yard'); setCap('Every place, and who and what is there');
    await wait(260); drawWeb(w, v);
    await type(', and it showed. ');
    await wait(500);
  }
  async function beatItem() {
    await type('Under his arm were the ');
    var w = await mention('Bruce', ITEM, 'Bruce-Partington Submarine Plans');
    tab('item'); var v = show('plans'); setCap('Every clue: who holds it, where it has been');
    await wait(260); drawWeb(w, v);
    await type(', or what was left of them.');
    await wait(900);
  }
  async function beatArc() {
    newPara();
    await type('Holmes was on his feet before Lestrade had finished. ');
    tab('arc'); show('arc'); setCap('Each character’s arc, a glance away');
    var c = await drawCurve();
    await type('The game was afoot.');
    await wait(300); selectKf(c, 1); await wait(450); selectKf(c, 2);
    await wait(1400);
  }
  async function beatFlow() {
    flowOn(); setCap('Flowstate: no going back, just forward');
    await wait(700);
    newPara('fs-live');
    var s1 = await type('I had not seen him so alive in weeks. ');
    s1.classList.add('lock');
    var s2 = await type('He was already reaching for his coat.');
    await wait(500); s2.classList.add('lock');
    await wait(1800);
    flowOff();
  }

  async function reset() {
    var added = [].slice.call(prose.querySelectorAll('p')).slice(2);
    added.forEach(function (p) { p.style.opacity = 0; });
    clearWeb();
    await wait(650);
    added.forEach(function (p) { p.parentNode.removeChild(p); });
    off = 0; scrollEl.style.transform = '';
    words = 435; total = 7191; wordsEl.textContent = words; totalEl.textContent = fmt(total);
    tab('char'); show('list');
    stage.querySelectorAll('.pa-kr').forEach(function (r, i) { r.classList.toggle('on', i === 0); });
    setCap('Your manuscript, with your whole world beside it');
    newPara();
    await wait(1000);
  }

  // Start once the hero frame has risen into place (the page's reveal script adds .animate-in).
  async function revealed() {
    while (figure && figure.hasAttribute('data-animate') && !figure.classList.contains('animate-in')) await wait(100);
    await wait(1300);
  }

  async function run() {
    live = prose.querySelector('[data-live]'); live.appendChild(caret);
    if (reduce) { instant = true; await beatCharacter(); return; }
    await revealed();
    for (;;) {
      await beatCharacter(); await beatPlace(); await beatItem(); await beatArc(); await beatFlow();
      await wait(1600);
      await reset();
    }
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run);
})();
