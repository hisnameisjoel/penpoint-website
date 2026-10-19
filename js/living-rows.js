/* Living Rows engine: plays the drawn app windows in the home page feature rows.
   Each [data-lr-frame][data-scene] holds one scene: a drawn Penpoint window (.lp-stage, logical size
   from data-w/data-h on [data-lr-stage]) scaled down to the frame's width. A scene registers with
     LR.scene('search', async function (s) { ... });
   and gets a fresh toolkit `s` on every play (see makeKit below).
   Lifecycle: plays once when the frame is half in view, rests on its last frame, and plays again
   from the top after it has fully left the screen and come back. data-loop="ms" on the frame makes
   it replay after that many ms instead. Every play starts from a pristine copy of the stage markup.
   Reduced motion runs the scene in instant mode: waits resolve at once, transitions are off, the
   pointer and the drawn lines are skipped unless a call opts in, so it lands on the final frame. */
(function () {
  var ICONS = 'images/living-page/icons.svg#';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var CANCEL = { cancelled: true };
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var registry = {}, runners = [];

  function Runner(frame) {
    var r = this;
    r.frame = frame;
    r.stage = frame.querySelector('[data-lr-stage]');
    r.name = frame.getAttribute('data-scene');
    r.W = +r.stage.getAttribute('data-w') || 1024;
    r.H = +r.stage.getAttribute('data-h') || 680;
    r.pristine = r.stage.innerHTML;
    r.dirty = false; // the markup is untouched until the first play, so that play needs no rebuild
    r.state = 'idle'; r.gen = 0; r.ratio = 0; r.paused = true; r.waiters = []; r.timers = []; r.intervals = []; r.offs = [];
    r.loop = frame.hasAttribute('data-loop') ? (+frame.getAttribute('data-loop') || 2500) : 0;
    r.scale = 1;
    frame.style.aspectRatio = r.W + ' / ' + r.H;
    r.stage.style.width = r.W + 'px'; r.stage.style.height = r.H + 'px';
    var fitW = -1;
    r.fit = function () {
      // Only a width change moves anything. Phones fire resize whenever the address bar slides in or out
      // mid-scroll; rewriting every frame's height then forced a layout per frame at the worst moment.
      var w = frame.clientWidth;
      if (w === fitW) return;
      fitW = w;
      r.scale = w / r.W;
      r.stage.style.setProperty('--lp-s', r.scale);
      frame.style.height = (Math.round(r.H * r.scale) + 2) + 'px'; // border-box: stage + 1px border top and bottom
    };
    r.fit();
    window.addEventListener('resize', r.fit);
    // fit() runs a frame later: setting the height inside the callback would trip the ResizeObserver loop error.
    if ('ResizeObserver' in window) new ResizeObserver(function () { requestAnimationFrame(r.fit); }).observe(frame);
  }

  Runner.prototype.setPaused = function (p) {
    this.paused = p;
    if (!p) { var w = this.waiters; this.waiters = []; w.forEach(function (f) { f(); }); }
  };

  // Throw away whatever is on stage (timers, listeners, a play in flight) and restore the pristine markup.
  Runner.prototype.reset = function () {
    this.gen++;
    this.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    this.offs.forEach(function (f) { f(); });
    this.timers = []; this.intervals = []; this.offs = [];
    var w = this.waiters; this.waiters = []; w.forEach(function (f) { f(); }); // wake them so they see the new gen and unwind
    if (this.dirty) this.stage.innerHTML = this.pristine;
    this.dirty = false;
    this.stage.classList.remove('lr-instant');
    this.state = 'idle';
  };

  Runner.prototype.play = function (instant) {
    var r = this, fn = registry[r.name];
    if (!fn) return;
    r.reset();
    r.dirty = true;
    r.state = 'playing';
    if (instant) r.stage.classList.add('lr-instant');
    var kit = makeKit(r, !!instant, r.gen);
    r.frame.dispatchEvent(new CustomEvent('lr:start', { bubbles: true, detail: { scene: r.name, instant: !!instant } }));
    Promise.resolve().then(function () { return fn(kit); }).then(function () {
      if (kit.gen !== r.gen) return;
      r.state = 'done';
      // A resting scene does no work: stop any ticker a scene left running (one-shot timers may still finish a fade).
      r.intervals.forEach(function (t) { clearInterval(t); }); r.intervals = [];
      r.frame.dispatchEvent(new CustomEvent('lr:done', { bubbles: true, detail: { scene: r.name, instant: !!instant } }));
      if (r.loop && !instant) kit.wait(r.loop).then(function () { if (kit.gen === r.gen) r.play(false); }, function () {});
    }, function (e) {
      if (e !== CANCEL) { console.error('[living rows] scene "' + r.name + '" failed', e); }
    });
  };

  Runner.prototype.onView = function (ratio) {
    this.ratio = ratio;
    var shown = ratio >= 0.5 && !document.hidden;
    this.setPaused(!shown);
    this.frame.classList.toggle('lp-off', ratio === 0 || document.hidden); // freezes CSS animations off screen (living-page.css)
    if (shown && this.state === 'idle') this.play(reduce);
    // Fully off screen after it finished: start over next time it comes into view. The markup rebuild waits for an
    // idle moment so it never lands in the middle of a scroll.
    if (ratio === 0 && this.state === 'done' && !reduce && !this.resetQueued) {
      var r = this, idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
      r.resetQueued = true;
      idle(function () { r.resetQueued = false; if (r.ratio === 0 && r.state === 'done') r.reset(); }, { timeout: 2000 });
    }
  };

  /* ---------------------------------------------------------------- the scene toolkit */
  function makeKit(r, instant, gen) {
    var stage = r.stage;
    var s = { stage: stage, frame: r.frame, section: r.frame.closest('section'), figure: r.frame.closest('figure'), W: r.W, H: r.H, instant: instant, gen: gen };
    function live() { if (r.gen !== gen) throw CANCEL; }

    s.$ = function (sel) { return stage.querySelector(sel); };
    s.$$ = function (sel) { return [].slice.call(stage.querySelectorAll(sel)); };
    s.icon = function (id, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="' + ICONS + id + '"/></svg>'; };
    s.iconHref = function (id) { return ICONS + id; };

    // Wait ms, holding while the frame is off screen. Rejects (and so unwinds the scene) after a reset.
    s.wait = function (ms) {
      if (instant) return r.gen === gen ? Promise.resolve() : Promise.reject(CANCEL);
      return new Promise(function (ok) { r.timers.push(setTimeout(ok, ms || 0)); }).then(function next() {
        live();
        if (r.paused) return new Promise(function (ok) { r.waiters.push(ok); }).then(next);
      });
    };
    // Timers that die with the play. every() skips ticks while paused.
    s.later = function (fn, ms) { var t = setTimeout(function () { if (r.gen === gen) fn(); }, instant ? 0 : ms); r.timers.push(t); return t; };
    s.every = function (fn, ms) { var t = setInterval(function () { if (r.gen === gen && !r.paused) fn(); }, ms); r.timers.push(t); r.intervals.push(t); return t; };
    s.listen = function (target, type, fn) { target.addEventListener(type, fn); r.offs.push(function () { target.removeEventListener(type, fn); }); };
    // Next paint (lets a class change start its CSS transition).
    s.frameTick = function () { return instant ? Promise.resolve() : new Promise(function (ok) { requestAnimationFrame(function () { requestAnimationFrame(ok); }); }).then(live); };

    // An element's box in stage pixels (unscaled). A wrapped inline uses its last line unless all=true.
    s.rel = function (el, all) {
      var st = stage.getBoundingClientRect(), k = st.width / r.W; // the stage's real drawn scale
      function conv(a) { return { x: (a.left - st.left) / k, y: (a.top - st.top) / k, w: a.width / k, h: a.height / k }; }
      if (el && el.x !== undefined && el.nodeType === undefined) return { x: el.x, y: el.y, w: el.w || 0, h: el.h || 0 };
      var rs = el.getClientRects();
      if (all) return [].map.call(rs, conv);
      return conv(rs.length > 1 ? rs[rs.length - 1] : el.getBoundingClientRect());
    };

    // Type text into el, one character at a time, keeping any child elements (e.g. a caret) after it.
    // o: { min: 28, spread: 42, punct: 200, before: node to insert before, onChar(ch, textNode) }
    s.type = async function (el, text, o) {
      o = o || {};
      var node = document.createTextNode('');
      el.insertBefore(node, o.before !== undefined ? o.before : (el.querySelector(':scope > .lp-caret') || null));
      if (instant) { node.data = text; if (o.onChar) o.onChar(text[text.length - 1], node); return node; }
      stage.classList.add('lp-typing');
      try {
        for (var i = 0; i < text.length; i++) {
          var ch = text[i];
          node.data += ch;
          if (o.onChar) o.onChar(ch, node);
          var d = (o.min || 28) + Math.random() * (o.spread === undefined ? 42 : o.spread);
          if (',.;:!?'.indexOf(ch) !== -1) d += (o.punct === undefined ? 200 : o.punct);
          await s.wait(d);
        }
      } finally { stage.classList.remove('lp-typing'); }
      return node;
    };
    s.caret = function () { var c = document.createElement('span'); c.className = 'lp-caret'; return c; };

    /* ---- the orange Story Web: lines, rings and underlines drawn over the window ---- */
    var web = document.createElementNS(SVGNS, 'svg');
    web.setAttribute('class', 'lp-web lr-web');
    web.setAttribute('viewBox', '0 0 ' + r.W + ' ' + r.H);
    stage.appendChild(web);
    s.web = web;
    function add(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); web.appendChild(n); return n; }
    // Draw a path in with the dash trick. o: { dur: 700, hold: ms then fade, still: draw it in instant mode too, cls }
    function drawPath(d, o, dots) {
      o = o || {};
      if (instant && !o.still) return { el: null, fade: function () {}, remove: function () {} };
      var p = add('path', { d: d, 'class': o.cls || '' });
      var nodes = [p];
      (dots || []).forEach(function (pt) { nodes.push(add('circle', { cx: pt[0], cy: pt[1], r: 3, 'class': o.cls || '' })); });
      var h = {
        el: p, nodes: nodes,
        fade: function () { nodes.forEach(function (n) { n.style.opacity = 0; }); s.later(h.remove, 800); },
        remove: function () { nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); }
      };
      if (!instant) {
        var len = p.getTotalLength();
        p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect();
        p.style.transition = 'stroke-dashoffset ' + (o.dur || 700) + 'ms cubic-bezier(.4,0,.2,1), opacity .7s ease';
        p.style.strokeDashoffset = 0;
        nodes.slice(1).forEach(function (c, i) {
          c.style.opacity = 0; c.style.transition = 'opacity .25s ease';
          s.later(function () { c.style.opacity = 1; }, i === 0 ? 0 : (o.dur || 700) - 120);
        });
      }
      if (o.hold) s.later(h.fade, o.hold);
      return h;
    }
    s.path = function (d, o) { return drawPath(d, o); };
    // Anchor point on a box side: 'top' | 'bottom' | 'left' | 'right' | 'center'.
    function anchor(b, side) {
      switch (side) {
        case 'top': return [b.x + b.w / 2, b.y];
        case 'bottom': return [b.x + b.w / 2, b.y + b.h];
        case 'left': return [b.x, b.y + b.h / 2];
        case 'right': return [b.x + b.w, b.y + b.h / 2];
        default: return [b.x + b.w / 2, b.y + b.h / 2];
      }
    }
    var NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], center: [0, 0] };
    function autoSides(a, b) {
      var dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right'];
      return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    }
    // A curved line from a to b (elements or {x,y,w,h} boxes in stage px).
    // o: { from: side, to: side, gap: 4, bend: 0.4, dx1, dy1, dx2, dy2, dots: true, ...drawPath opts }
    s.line = function (a, b, o) {
      o = o || {};
      var A = s.rel(a), B = s.rel(b), sides = autoSides(A, B);
      var fs = o.from || sides[0], ts = o.to || sides[1], gap = o.gap === undefined ? 4 : o.gap;
      var p1 = anchor(A, fs), p2 = anchor(B, ts), n1 = NORMAL[fs], n2 = NORMAL[ts];
      p1 = [p1[0] + n1[0] * gap + (o.dx1 || 0), p1[1] + n1[1] * gap + (o.dy1 || 0)];
      p2 = [p2[0] + n2[0] * gap + (o.dx2 || 0), p2[1] + n2[1] * gap + (o.dy2 || 0)];
      var dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(30, dist * (o.bend === undefined ? 0.4 : o.bend));
      var d = 'M' + p1[0] + ',' + p1[1] + ' C' + (p1[0] + n1[0] * k) + ',' + (p1[1] + n1[1] * k) + ' ' + (p2[0] + n2[0] * k) + ',' + (p2[1] + n2[1] * k) + ' ' + p2[0] + ',' + p2[1];
      return drawPath(d, o, o.dots === false ? [] : [p1, p2]);
    };
    // A rectangle drawn around an element. o: { pad: 5, ...drawPath opts }
    s.ring = function (el, o) {
      o = o || {};
      var b = s.rel(el), pad = o.pad === undefined ? 5 : o.pad;
      var x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
      var d = 'M' + x + ',' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + x + ' Z';
      return drawPath(d, o);
    };
    // An underline under each line of an element's text, o.off px below the baseline. o: { off: 2, ...drawPath opts }
    // A line box's rect runs to the font's full descent (lower than the text looks), so the baseline is measured
    // with a zero-size probe instead; it sits the same distance below the top of every line's rect.
    s.underline = function (el, o) {
      o = o || {};
      var rects = s.rel(el, true), probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.insertBefore(probe, el.firstChild);
      var asc = s.rel(probe).y - rects[0].y;
      el.removeChild(probe);
      var off = o.off === undefined ? 2 : o.off;
      var d = rects.map(function (b) { var y = b.y + asc + off; return 'M' + b.x + ',' + y + ' H' + (b.x + b.w); }).join(' ');
      return drawPath(d, o);
    };
    s.clearWeb = function () { [].slice.call(web.childNodes).forEach(function (n) { n.style.opacity = 0; }); s.later(function () { web.innerHTML = ''; }, 800); };

    /* ---- a mouse pointer, for clicks the story needs ---- */
    var ptr = document.createElement('div');
    ptr.className = 'lr-ptr';
    ptr.innerHTML = '<svg viewBox="0 0 20 24"><path d="M2 1.5 L2 19.5 L6.6 15.4 L9.6 22 L12.6 20.7 L9.7 14.2 L16 14.2 Z"/></svg><i></i>';
    stage.appendChild(ptr);
    var px = r.W * 0.72, py = r.H + 30;
    function placePtr() { ptr.style.transform = 'translate(' + px + 'px,' + py + 'px)'; }
    placePtr();
    s.pointer = {
      // Glide to an element (o.fx/o.fy = point inside it as fractions, default .5/.5) or to {x,y}. o.dur ms.
      to: async function (target, o) {
        o = o || {};
        if (instant) return;
        if (target.nodeType) { var b = s.rel(target); px = b.x + b.w * (o.fx === undefined ? 0.5 : o.fx); py = b.y + b.h * (o.fy === undefined ? 0.5 : o.fy); }
        else { px = target.x; py = target.y; }
        ptr.classList.add('on');
        ptr.style.transitionDuration = (o.dur || 650) + 'ms';
        placePtr();
        await s.wait(o.dur || 650);
      },
      click: async function () {
        if (instant) return;
        ptr.classList.add('down'); ptr.classList.remove('ring'); void ptr.offsetWidth; ptr.classList.add('ring');
        await s.wait(150);
        ptr.classList.remove('down');
      },
      hide: function () { ptr.classList.remove('on'); },
      el: ptr
    };

    // The row's figcaption title, if the figure has one marked [data-lr-cap].
    s.caption = function (t) {
      var c = s.figure && s.figure.querySelector('[data-lr-cap]');
      if (!c || c.textContent === t) return;
      if (instant) { c.textContent = t; return; }
      c.style.opacity = 0;
      s.later(function () { c.textContent = t; c.style.opacity = 1; }, 380);
    };

    return s;
  }

  /* ---------------------------------------------------------------- wiring */
  var LR = window.LR = {
    scene: function (name, fn) { registry[name] = fn; },
    runners: runners,
    replay: function (frame) { var r = find(frame); if (r) { r.play(false); } },
    still: function (frame) { var r = find(frame); if (r) { r.play(true); } }
  };
  function find(frame) { for (var i = 0; i < runners.length; i++) if (runners[i].frame === frame || runners[i].name === frame) return runners[i]; return null; }

  function init() {
    [].forEach.call(document.querySelectorAll('[data-lr-frame]'), function (f) { runners.push(new Runner(f)); });
    if (reduce) { runners.forEach(function (r) { r.play(true); }); } // still frames from the start, never replayed
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { var r = find(e.target); if (r) r.onView(e.intersectionRatio); });
      }, { threshold: [0, 0.5, 1] });
      runners.forEach(function (r) { io.observe(r.frame); });
    } else {
      runners.forEach(function (r) { r.play(true); });
    }
    document.addEventListener('visibilitychange', function () {
      runners.forEach(function (r) { r.setPaused(document.hidden || r.ratio < 0.5); });
    });
  }
  // Scenes register in their own deferred scripts; start after them and after the fonts are in.
  function start() { (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(init); }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();

/* ==================================================================== switch */
/* One-Click Switch ("Write your book. Know your world."): the Manuscript row's live demo.
   A writer is mid-chapter in Manuscript Mode, clicks the back arrow to Worldbuilding (the app's real wipe transition),
   checks Professor Moriarty's notes, clicks the pen to come back, and writes the detail into the sentence.
   Real app UI: both windows, the transition (timings and clip-paths from ModeTransition.tsx + global.css), the nav rail hover.
   Abstractions drawn over the window: the orange Story Web underline and the mouse pointer.
   The row's two pills ([data-mw]) and the figure caption ([data-lr-cap]) follow the mode; visitors can click the pills. */
LR.scene('switch', async function (s) {
  var STOP = { stopped: true };            // thrown by w()/chk() when a visitor takes over with a pill
  var stopped = false, busy = false, mode = 'manuscript', scrollY = 0;
  var ms = s.$('[data-mode="manuscript"]'), wb = s.$('[data-mode="worldbuilding"]');
  var tr = s.$('.sw-tr'), nav = s.$('[data-nav]'), penRow = s.$('[data-nav-ms]'), back = s.$('[data-back]');
  var live = s.$('[data-live]'), card = s.$('.sw-card'), sticky = s.$('[data-sticky]');
  var thumb = s.$('.sw-detail .th'), hit = s.$('[data-hit]'), notes = s.$('[data-blk="notes"]');
  var pills = s.section ? [].slice.call(s.section.querySelectorAll('[data-mw]')) : [];

  var BASE_WORDS = 627, BOOK_WORDS = 7191;
  var CHUNK1 = 'I had met Professor Moriarty only once, and I remember';
  var CHUNK2 = ' his deep-set eyes beneath that domed forehead.';

  function chk() { if (stopped) throw STOP; }
  async function w(ms_) { await s.wait(ms_); chk(); }
  var P = {
    to: async function (t, o) { await s.pointer.to(t, o); chk(); },
    click: async function () { await s.pointer.click(); chk(); }
  };

  /* ---------- small helpers ---------- */
  function fmt(n) { return n.toLocaleString('en-US'); }
  function updateWords() {
    var n = (live.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    var a = s.$('[data-words]'), b = s.$('[data-total]');
    if (a) a.textContent = fmt(BASE_WORDS + n);
    if (b) b.textContent = fmt(BOOK_WORDS + n);
  }
  function clock() {
    var t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    s.$$('[data-clock]').forEach(function (el) { el.textContent = t; });
  }
  // Type text into parent, one character at a time, before the caret. Stops cleanly when a visitor takes over.
  async function typeInto(parent, text) {
    var node = document.createTextNode('');
    parent.insertBefore(node, parent.querySelector('.lp-caret') || null);
    if (s.instant) { node.data = text; updateWords(); return node; }
    s.stage.classList.add('lp-typing');
    try {
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        node.data += ch;
        if (ch === ' ') updateWords();
        var d = 20 + Math.random() * 26;
        if (',.;:!?'.indexOf(ch) !== -1) d += 170;
        await w(d);
      }
    } finally { s.stage.classList.remove('lp-typing'); }
    updateWords();
    return node;
  }

  /* ---------- the Character Page: scroll the detail pane ---------- */
  function setScroll(y) {
    scrollY = y;
    card.style.transform = y ? 'translateY(' + (-y) + 'px)' : '';
    sticky.classList.toggle('on', y > 8);
    thumb.style.top = (12 + Math.min(1, y / 2600) * 541) + 'px';
  }
  function notesScroll() { // scroll so the Notes block ends just inside the window (the next block stays below the fold)
    var b = s.rel(notes), bottomAtTop = b.y + b.h + scrollY;
    return Math.max(0, Math.round(bottomAtTop - 676));
  }

  /* ---------- pills + caption follow the mode ---------- */
  function showMode(to) {
    pills.forEach(function (p) {
      var on = p.getAttribute('data-mw') === to;
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
      p.style.background = on ? '#29241E' : 'transparent';
      p.style.color = on ? '#FEF9F0' : '#7D5D35';
    });
    s.caption(to === 'manuscript' ? 'Manuscript Mode' : 'The Character Page');
  }
  function swap(to) {
    mode = to;
    ms.classList.toggle('on', to === 'manuscript');
    wb.classList.toggle('on', to === 'worldbuilding');
    nav.classList.remove('x'); penRow.classList.remove('hov'); back.classList.remove('hov');
  }

  /* ---------- the app's mode transition: wipe-in 1100, hold 650 (swap in the middle), wipe-out 1100 ---------- */
  async function transition(to) {
    busy = true;
    s.pointer.hide();
    s.clearWeb();
    showMode(to);
    if (s.instant) { swap(to); busy = false; return; }
    var toMs = to === 'manuscript';
    tr.setAttribute('data-dir', toMs ? 'to-manuscript' : 'to-worldbuilding');
    s.$('[data-tr-title]').textContent = toMs ? 'Penpoint Manuscript' : 'Penpoint';
    s.$('[data-tr-sub]').textContent = toMs ? 'Time to write.' : 'Back to your world.';
    tr.setAttribute('data-phase', 'wipe-in');
    await s.wait(1100);
    tr.setAttribute('data-phase', 'hold');
    await s.wait(325);
    swap(to);
    await s.wait(325);
    tr.setAttribute('data-phase', 'wipe-out');
    await s.wait(1100);
    tr.setAttribute('data-phase', 'idle');
    busy = false;
  }

  /* ---------- the pills: a visitor's click stops the story and runs the real transition to that mode ---------- */
  function takeOver(to) {
    if (busy || to === mode) return;
    stopped = true;
    s.pointer.hide();
    s.clearWeb();
    transition(to).catch(function (e) { if (!(e && e.cancelled)) throw e; });
  }
  pills.forEach(function (p) {
    p.setAttribute('role', 'button');
    p.setAttribute('tabindex', '0');
    p.style.cursor = 'pointer';
    s.listen(p, 'click', function () { takeOver(p.getAttribute('data-mw')); });
    s.listen(p, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); takeOver(p.getAttribute('data-mw')); }
    });
  });
  showMode('manuscript');
  clock();
  updateWords();

  /* ---------- the story ---------- */
  try {
    if (s.instant) { // reduced motion / still: the finished sentence at once
      await typeInto(live, CHUNK1 + CHUNK2);
      return;
    }

    await w(400);
    // 1. mid-chapter: a few words go down, then the writer stops to check something
    await typeInto(live, CHUNK1);
    await w(450);

    // 2. click the real control back to Worldbuilding
    await P.to(back, { fx: 0.62, fy: 0.55, dur: 800 });
    back.classList.add('hov');
    await w(200);
    await P.click();
    await transition('worldbuilding');

    // 3. the character page: Moriarty's face and name, then down to his Notes; the orange line picks out the detail
    await w(700);
    var off = notesScroll();
    setScroll(off);
    await w(1050);
    s.underline(hit, { dur: 800 });
    await w(850);

    // 4. click the pen in the nav rail (it hover-expands) to go back to the page
    await P.to(s.$('[data-nav-ms] .ic'), { dur: 850 });
    nav.classList.add('x'); penRow.classList.add('hov');
    await w(400);
    await P.click();
    await transition('manuscript');

    // 5. keep writing: the detail goes into the sentence
    await w(450);
    await typeInto(live, CHUNK2);
    await w(950);
  } catch (e) {
    if (e !== STOP) throw e;
  }
});

/* ==================================================================== search */
/* "Search As You Type" (Searchbar row, "Your ideas will find you."). The Glorious Searchbar on its own, drawn
   larger than life so it reads on the page; no app window around it.
   Every list is the app's own, captured live after each keystroke (app-ref2/search/q-*.json) and built in by
   work/search/gen.cjs. Edit work/search/search.template.js, then rerun gen.cjs; never edit scenes/search.js.
   Story (about 11 s): "mrs hudson" narrows the list to Mrs. Hudson (orange ring). The query is held down with
   Backspace (the list stays until the keys stop, as the app's 50 ms debounce does) and "violin" is typed: the
   word is found inside the notes on a character, a place and an item (orange underlines). Rests there. */
LR.scene('search', async function (s) {
  var STATES = {"m":{"g":[{"h":"Suggestions","rows":[{"s":1,"t":"Mary Morstan","sel":1},{"s":1,"t":"Mary's Pearl Necklace"},{"s":1,"t":"Meiringen"},{"s":1,"t":"Merripit House"},{"s":1,"t":"Merton's Boxing Gloves"},{"s":1,"t":"Moran's Air Rifle"},{"s":1,"t":"Moriarty’s Notebook"},{"s":1,"t":"Moriarty’s criminal network structure"},{"s":1,"t":"Mrs. Hudson"},{"s":1,"t":"Mrs. Hudson's role"}]}],"sb":330},"mr":{"g":[{"h":"Results","rows":[{"t":"<mark>Mr</mark>s. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","b":"Secondary","v":"char-hudson"},{"t":"<mark>Mr</mark>s Watson","ic":"spline","rot":1,"sub":"The Governess from Sign of Four — Keyframe: Marriage and domesticity","v":"capp-mary-4"},{"t":"<mark>Mr</mark> Holmes's Eyes","ic":"spline","rot":1,"sub":"A Shilling a Day — Keyframe: Recruited for the Irregulars","v":"capp-wiggins-2"},{"t":"<mark>Mr</mark>s. Hudson's role","ic":"file-text","sub":"Note","v":"note-10"},{"t":"Mary Morstan <span class=\"sr-ra\">— “Mary/Mrs. Watson”</span>","ic":"user","sub":"Alias","snip":"Mary/<mark>Mr</mark>s. Watson","b":"Background","v":"char-mary-morstan"},{"t":"Selden","ic":"user","sub":"Bio","snip":"...iding on the moor. Brother to <mark>Mr</mark>s. Barrymore, he becomes an unwitting pawn in the larger mystery.","b":"Background","v":"char-selden"}]}],"sb":65},"mrs":{"g":[{"h":"Results","rows":[{"t":"<mark>Mrs</mark>. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","b":"Secondary","v":"char-hudson"},{"t":"<mark>Mrs</mark> Watson","ic":"spline","rot":1,"sub":"The Governess from Sign of Four — Keyframe: Marriage and domesticity","v":"capp-mary-4"},{"t":"<mark>Mrs</mark>. Hudson's role","ic":"file-text","sub":"Note","v":"note-10"},{"t":"Mary Morstan <span class=\"sr-ra\">— “Mary/Mrs. Watson”</span>","ic":"user","sub":"Alias","snip":"Mary/<mark>Mrs</mark>. Watson","b":"Background","v":"char-mary-morstan"},{"t":"Selden","ic":"user","sub":"Bio","snip":"...iding on the moor. Brother to <mark>Mrs</mark>. Barrymore, he becomes an unwitting pawn in the larger mystery.","b":"Background","v":"char-selden"}]}],"sb":65},"mrs ":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","b":"Secondary","v":"char-hudson"},{"t":"<mark>Mrs </mark>Watson","ic":"spline","rot":1,"sub":"The Governess from Sign of Four — Keyframe: Marriage and domesticity","v":"capp-mary-4"},{"t":"Mrs. Hudson's role","ic":"file-text","sub":"Note","v":"note-10"},{"t":"Mary Morstan <span class=\"sr-ra\">— “Mary/Mrs. Watson”</span>","ic":"user","sub":"Alias","snip":"Mary/<mark>Mrs</mark>. Watson","b":"Background","v":"char-mary-morstan"},{"t":"Selden","ic":"user","sub":"Bio","snip":"...iding on the moor. Brother to <mark>Mrs</mark>. Barrymore, he becomes an unwitting pawn in the larger mystery.","b":"Background","v":"char-selden"}]}],"sb":65},"mrs h":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Mary Morstan <span class=\"sr-ra\">— “Mary/Mrs. Watson”</span>","ic":"user","sub":"Alias","snip":"Mary/<mark>Mrs</mark>. Watson","b":"Background","v":"char-mary-morstan"},{"t":"Selden","ic":"user","sub":"Bio","snip":"...rer, an escaped convict from hiding on the moor. Brother to <mark>Mrs</mark>. Barrymore, he becomes an unwitting pawn in the larger...","b":"Background","v":"char-selden"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...Watson’s grief turns to joy then anger <mark>Holmes</mark> apologizes (somewhat) for deception <mark>Mrs</mark>. <mark>Hudson</mark> screams upon seeing ghost Watson: \"You could <mark>have</mark> trusted me!\" <mark>Holmes</mark>: \"Your grief <mark>had</mark> to convince\" Reunion dinner at...","v":"chapter-7"}]}],"sb":52},"mrs hu":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...Holmes softer after travels? More <mark>human</mark>? <mark>Mrs</mark>. <mark>Hudson</mark> kept rooms exactly as they were for three years! She knew he'd return.","v":"chapter-7"},{"t":"Chapter 5: The Bruce-Partington Plans","ic":"book-open","sub":"Chapter","snip":"...later reveal? Mycroft eating at 221B is <mark>huge</mark> character moment. Maybe have him deduce something about <mark>Mrs</mark>. <mark>Hudson</mark>'s cooking?","v":"chapter-3"},{"t":"Chapter 9: The Hound of the Baskervilles","ic":"book-open","sub":"Chapter","snip":"...ng portrait reveals Stapleton resembles <mark>Hugo</mark> Baskerville on hound creates supernatural appearance Stapleton is Rodger Baskerville, son of youngest brother Investigation Notes The trap: Holmes uses Sir Henry as bait (ethically questionable) Lestrade brought from London secretly Watson armed and...","v":"chapter-9"}]}],"sb":73},"mrs hud":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...mes apologizes (somewhat) for deception <mark>Mrs</mark>. <mark>Hudson</mark> screams upon seeing ghost Watson: \"You could have trusted me!\" Holmes: \"Your grief had to convince\" Reunion dinner at...","v":"chapter-7"},{"t":"Chapter 3: The Adventure of the Illustrious Client","ic":"book-open","sub":"Chapter","snip":"...repares medical bag and checks revolver <mark>Mrs</mark>. <mark>Hudson</mark> brings supper (Holmes ignores it) Holmes plays violin (Mendelssohn) while thinking Holmes: \"Baron Gruner has powerful friends and no scruples\" Chapter Arc Mysterious summons → deduction game with Watson → research reveals...","v":"chapter-1"},{"t":"Chapter 1: Planning the Reichenbach Deception","ic":"book-open","sub":"Chapter","snip":"...Holmes requests Mycroft protect Watson/<mark>Mrs</mark>. <mark>Hudson</mark>...","v":"chapter-4"}]}],"sb":82},"mrs huds":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...mes apologizes (somewhat) for deception <mark>Mrs</mark>. <mark>Hudson</mark> screams upon seeing ghost Watson: \"You could have trusted me!\" Holmes: \"Your grief had to convince\" Reunion dinner at...","v":"chapter-7"},{"t":"Chapter 3: The Adventure of the Illustrious Client","ic":"book-open","sub":"Chapter","snip":"...repares medical bag and checks revolver <mark>Mrs</mark>. <mark>Hudson</mark> brings supper (Holmes ignores it) Holmes plays violin (Mendelssohn) while thinking Holmes: \"Baron Gruner has powerful friends and no scruples\" Chapter Arc Mysterious summons → deduction game with Watson → research reveals...","v":"chapter-1"},{"t":"Chapter 1: Planning the Reichenbach Deception","ic":"book-open","sub":"Chapter","snip":"...Holmes requests Mycroft protect Watson/<mark>Mrs</mark>. <mark>Hudson</mark>...","v":"chapter-4"}]}],"sb":82},"mrs hudso":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...mes apologizes (somewhat) for deception <mark>Mrs</mark>. <mark>Hudson</mark> screams upon seeing ghost Watson: \"You could have trusted me!\" Holmes: \"Your grief had to convince\" Reunion dinner at...","v":"chapter-7"},{"t":"Chapter 3: The Adventure of the Illustrious Client","ic":"book-open","sub":"Chapter","snip":"...repares medical bag and checks revolver <mark>Mrs</mark>. <mark>Hudson</mark> brings supper (Holmes ignores it) Holmes plays violin (Mendelssohn) while thinking Holmes: \"Baron Gruner has powerful friends and no scruples\" Chapter Arc Mysterious summons → deduction game with Watson → research reveals...","v":"chapter-1"},{"t":"Chapter 1: Planning the Reichenbach Deception","ic":"book-open","sub":"Chapter","snip":"...Holmes requests Mycroft protect Watson/<mark>Mrs</mark>. <mark>Hudson</mark>...","v":"chapter-4"}]}],"sb":82},"mrs hudson":{"g":[{"h":"Results","rows":[{"t":"Mrs. Hudson <span class=\"sr-ra\">— “Martha/Mrs. H”</span>","img":"char-hudson","sub":"Alias","snip":"Martha/<mark>Mrs</mark>. H","b":"Secondary","v":"char-hudson"},{"t":"Chapter 6: The Empty House","ic":"book-open","sub":"Chapter","snip":"...mes apologizes (somewhat) for deception <mark>Mrs</mark>. <mark>Hudson</mark> screams upon seeing ghost Watson: \"You could have trusted me!\" Holmes: \"Your grief had to convince\" Reunion dinner at...","v":"chapter-7"},{"t":"Chapter 3: The Adventure of the Illustrious Client","ic":"book-open","sub":"Chapter","snip":"...repares medical bag and checks revolver <mark>Mrs</mark>. <mark>Hudson</mark> brings supper (Holmes ignores it) Holmes plays violin (Mendelssohn) while thinking Holmes: \"Baron Gruner has powerful friends and no scruples\" Chapter Arc Mysterious summons → deduction game with Watson → research reveals...","v":"chapter-1"},{"t":"Chapter 1: Planning the Reichenbach Deception","ic":"book-open","sub":"Chapter","snip":"...Holmes requests Mycroft protect Watson/<mark>Mrs</mark>. <mark>Hudson</mark>...","v":"chapter-4"}]}],"sb":82},"v":{"g":[{"h":"Suggestions","rows":[{"s":1,"t":"Victorian Pocket Watch"},{"s":1,"t":"Victorian forensics research"},{"s":1,"t":"Vienna"},{"s":1,"t":"Viennese Coffee Service"}]}],"sb":0},"vi":{"g":[{"h":"Results","rows":[{"t":"Count Negretto Syl<mark>vi</mark>us","img":"char-count-negretto-sylvius","sub":"Bio","b":"Secondary","v":"char-count-negretto-sylvius"},{"t":"<mark>Vi</mark>enna","ic":"search","sub":"Location","b":"Background","v":"loc-vienna"},{"t":"<mark>Vi</mark>ctorian Pocket Watch","ic":"package","sub":"Item","b":"Background","v":"item-11"},{"t":"<mark>Vi</mark>ennese Coffee Service","ic":"package","sub":"Item","b":"Background","v":"item-23"},{"t":"<mark>Vi</mark>ctorian Era","ic":"tag","sub":"64 items","v":"tag-victorian-era"},{"t":"Bullet Holes and <mark>Vi</mark>olin at 3am","ic":"spline","rot":1,"sub":"Description","v":"carc-hudson"}]}],"sb":30},"vio":{"g":[{"h":"Results","rows":[{"t":"Bullet Holes and <mark>Vio</mark>lin at 3am","ic":"spline","rot":1,"sub":"Description","v":"carc-hudson"},{"t":"Count Negretto Sylvius","img":"char-count-negretto-sylvius","sub":"Bio","snip":"...n and criminal, known for his <mark>vio</mark>lent temper and association with international crime rings. Suspected in multiple jewel...","b":"Secondary","v":"char-count-negretto-sylvius"},{"t":"Sherlock Holmes <span class=\"sr-ra\">— “Holmes/Sherlock/Sigerson/Altamont”</span>","img":"char-sherlock","sub":"Notes","snip":"...ty in equal measure. He plays <mark>vio</mark>lin at all hours, often when deep in thought, and maintains irregular eating habits dur...","b":"Primary","v":"char-sherlock"},{"t":"221B Baker Street","img":"loc-221b-baker-street","sub":"Location","snip":"...case files, newspapers, and his beloved <mark>violin</mark>. The address stands on the west side of Baker Street, a few doors south of the Underground station and within an easy walk of Regent’s Park, Portman Square and the Langham Hotel—which is convenient, as a surprising proportion of...","b":"Primary","v":"loc-221b-baker-street"}]}],"sb":98},"viol":{"g":[{"h":"Results","rows":[{"t":"Bullet Holes and <mark>Viol</mark>in at 3am","ic":"spline","rot":1,"sub":"Description","v":"carc-hudson"},{"t":"Count Negretto Sylvius","img":"char-count-negretto-sylvius","sub":"Bio","snip":"...n and criminal, known for his <mark>viol</mark>ent temper and association with international crime rings. Suspected in multiple jewel...","b":"Secondary","v":"char-count-negretto-sylvius"},{"t":"Sherlock Holmes <span class=\"sr-ra\">— “Holmes/Sherlock/Sigerson/Altamont”</span>","img":"char-sherlock","sub":"Notes","snip":"...ty in equal measure. He plays <mark>viol</mark>in at all hours, often when deep in thought, and maintains irregular eating habits dur...","b":"Primary","v":"char-sherlock"},{"t":"221B Baker Street","img":"loc-221b-baker-street","sub":"Location","snip":"...case files, newspapers, and his beloved <mark>violin</mark>. The address stands on the west side of Baker Street, a few doors south of the Underground station and within an easy walk of Regent’s Park, Portman Square and the Langham Hotel—which is convenient, as a surprising proportion of...","b":"Primary","v":"loc-221b-baker-street"}]}],"sb":90},"violi":{"g":[{"h":"Results","rows":[{"t":"Bullet Holes and <mark>Violi</mark>n at 3am","ic":"spline","rot":1,"sub":"Description","v":"carc-hudson"},{"t":"Sherlock Holmes <span class=\"sr-ra\">— “Holmes/Sherlock/Sigerson/Altamont”</span>","img":"char-sherlock","sub":"Notes","snip":"...ty in equal measure. He plays <mark>violi</mark>n at all hours, often when deep in thought, and maintains irregular eating habits dur...","b":"Primary","v":"char-sherlock"},{"t":"221B Baker Street","img":"loc-221b-baker-street","sub":"Location","snip":"...case files, newspapers, and his beloved <mark>violin</mark>. The address stands on the west side of Baker Street, a few doors south of the Underground station and within an easy walk of Regent’s Park, Portman Square and the Langham Hotel—which is convenient, as a surprising proportion of...","b":"Primary","v":"loc-221b-baker-street"},{"t":"The Stradivarius","img":"item-6","sub":"Item","snip":"Holmes’ prized Stradivarius <mark>violin</mark>, worth at least 500 guineas. This exceptional instrument aids his thinking and is one of his most treasured possessions.","b":"Primary","v":"item-6"}]}],"sb":103},"violin":{"g":[{"h":"Results","rows":[{"t":"Bullet Holes and <mark>Violin</mark> at 3am","ic":"spline","rot":1,"sub":"Description","v":"carc-hudson"},{"t":"Sherlock Holmes <span class=\"sr-ra\">— “Holmes/Sherlock/Sigerson/Altamont”</span>","img":"char-sherlock","sub":"Notes","snip":"...ty in equal measure. He plays <mark>violin</mark> at all hours, often when deep in thought, and maintains irregular eating habits dur...","b":"Primary","v":"char-sherlock"},{"t":"221B Baker Street","img":"loc-221b-baker-street","sub":"Location","snip":"...case files, newspapers, and his beloved <mark>violin</mark>. The address stands on the west side of Baker Street, a few doors south of the Underground station and within an easy walk of Regent’s Park, Portman Square and the Langham Hotel—which is convenient, as a surprising proportion of...","b":"Primary","v":"loc-221b-baker-street"},{"t":"The Stradivarius","img":"item-6","sub":"Item","snip":"Holmes’ prized Stradivarius <mark>violin</mark>, worth at least 500 guineas. This exceptional instrument aids his thinking and is one of his most treasured possessions.","b":"Primary","v":"item-6"}]}],"sb":103}};
  var ICONS = {"search":["0 0 24 24","<path d=\"m21 21-4.34-4.34\"></path><circle cx=\"11\" cy=\"11\" r=\"8\"></circle>"],"spline":["0 0 24 24","<circle cx=\"19\" cy=\"5\" r=\"2\"></circle><circle cx=\"5\" cy=\"19\" r=\"2\"></circle><path d=\"M5 17A12 12 0 0 1 17 5\"></path>"],"book-open":["0 0 24 24","<path d=\"M12 7v14\"></path><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"></path>"],"file-text":["0 0 24 24","<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\"></path><path d=\"M14 2v4a2 2 0 0 0 2 2h4\"></path><path d=\"M10 9H8\"></path><path d=\"M16 13H8\"></path><path d=\"M16 17H8\"></path>"],"user":["0 0 24 24","<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"></path><circle cx=\"12\" cy=\"7\" r=\"4\"></circle>"],"package":["0 0 24 24","<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\"></path><path d=\"M12 22V12\"></path><polyline points=\"3.29 7 12 12 20.71 7\"></polyline><path d=\"m7.5 4.27 9 5.15\"></path>"],"tag":["0 0 24 24","<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"></path><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"></circle>"],"map-pin":["0 0 24 24","<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"></path><circle cx=\"12\" cy=\"10\" r=\"3\"></circle>"]}; // inline icons (an external-sprite <use> repaints blank for a frame when re-created)
  var pop = s.$('.sr-pop'), qt = s.$('.sr-qt'), inner = s.$('.sr-g'), thumb = s.$('.sr-sb b');

  function icon(id, cls) { var d = ICONS[id]; return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="' + d[0] + '">' + d[1] + '</svg>'; }
  function el(html) { var t = document.createElement('div'); t.innerHTML = html; return t.firstChild; }
  function make(r) {
    if (r.s) return el('<div class="sr-s">' + icon('search') + '<span></span></div>');
    var lead = r.img ? '<img src="images/living-rows/search-' + r.img + '.webp" alt="">' : icon(r.ic, r.rot ? 'rot' : '');
    return el('<div class="sr-r" data-v="' + r.v + '"><span class="sr-ri"' + (r.col ? ' style="color:' + r.col + '"' : '') + '>' + lead + '</span><div class="sr-rt"></div></div>');
  }
  // Update a row's words in place; its picture or icon is never touched.
  function fill(e, r) {
    if (r.s) {
      e.classList.toggle('sel', !!r.sel);
      if (e.lastChild.textContent !== r.t) e.lastChild.textContent = r.t;
      return;
    }
    var html = '<div class="sr-rn">' + r.t + '</div>' + (r.sub ? '<div class="sr-rs">' + r.sub + '</div>' : '') + (r.snip ? '<div class="sr-rsn">' + r.snip + '</div>' : '');
    var rt = e.querySelector('.sr-rt'), b = e.querySelector('.sr-rb');
    if (rt.getAttribute('data-h') !== html) { rt.innerHTML = html; rt.setAttribute('data-h', html); }
    if (r.b) {
      if (!b) { b = document.createElement('span'); b.className = 'sr-rb'; e.appendChild(b); }
      if (b.textContent !== r.b) b.textContent = r.b;
    } else if (b) e.removeChild(b);
  }

  // Each keystroke redraws the list by reusing row elements (keyed by entity, kept even while a row is out of the
  // list) and moving them into the new order, so pictures and icons stay painted; a row is only built once per play.
  // Each state holds only the rows that show in the window (measured by work/search/visible-probe.mjs) and its
  // scrollbar thumb height, so a keystroke builds nothing out of sight and never stops to measure the page.
  var live = {}, pool = {};
  function render(q) {
    var S = STATES[q] || { g: [], sb: 0 }, st = S.g, next = {}, order = [];
    function take(k, mk) { while (next[k]) k += '+'; var e = pool[k] || (pool[k] = mk()); next[k] = e; return e; }
    st.forEach(function (g, gi) {
      if (gi) order.push(take('sep' + gi, function () { return el('<i class="sr-sep"></i>'); }));
      order.push(take('h:' + g.h, function () { return el('<div class="sr-gh">' + g.h + '</div>'); }));
      g.rows.forEach(function (r) {
        var e = take(r.s ? 's:' + r.t : 'r:' + r.v, function () { return make(r); });
        fill(e, r);
        order.push(e);
      });
    });
    Object.keys(live).forEach(function (k) { if (next[k] !== live[k] && live[k].parentNode) live[k].parentNode.removeChild(live[k]); });
    order.forEach(function (e, i) { if (inner.children[i] !== e) inner.insertBefore(e, inner.children[i] || null); });
    live = next;
    // The scrollbar shows only when the app's full list overflows; sb is its thumb height (0 = no scrollbar).
    pop.classList.toggle('scrolls', S.sb > 0);
    if (S.sb) thumb.style.height = S.sb + 'px';
  }
  

  var typed = '';
  function show() {
    qt.textContent = typed;
    pop.classList.toggle('has', typed.length > 0);
    render(typed);
  }
  async function key(ch, hold) { typed += ch; show(); await s.wait(hold); }
  // Backspace held down: one delete, the key-repeat pause, then rapid deletes. The list only changes once the keys stop.
  async function erase() {
    typed = typed.slice(0, -1); show();
    await s.wait(420);
    while (typed.length) {
      typed = typed.slice(0, -1);
      qt.textContent = typed;
      pop.classList.toggle('has', typed.length > 0);
      await s.wait(36);
    }
    await s.wait(50);
    render('');
  }

  // The resting marks: the typed word, found inside the notes on a character, a place and an item.
  var ECHO = ['char-sherlock', 'loc-221b-baker-street', 'item-6'];
  async function accents(animate) {
    for (var i = 0; i < ECHO.length; i++) {
      var m = s.$('.sr-r[data-v="' + ECHO[i] + '"] .sr-rsn mark');
      if (m) s.underline(m, { dur: 420, still: true, off: 4 });
      if (animate) await s.wait(330);
    }
  }

  if (s.instant) { typed = 'violin'; show(); await accents(false); return; }

  // One smooth run of keystrokes (each still outlasts the 50 ms debounce, so every list flashes past as in the app).
  async function typeWord(word) {
    s.stage.classList.add('lp-typing');
    for (var i = 0; i < word.length; i++) await key(word[i], 128 + Math.random() * 82);
    s.stage.classList.remove('lp-typing');
  }

  await s.wait(800);
  await typeWord('mrs hudson');
  await s.wait(700);
  var ring = s.ring(s.$('.sr-r[data-v="char-hudson"]'), { pad: 2, cls: 'thick', dur: 650 });
  await s.wait(1900);
  ring.fade();
  await s.wait(350);

  s.stage.classList.add('lp-typing');
  await erase();
  s.stage.classList.remove('lp-typing');
  await s.wait(750);

  await typeWord('violin');
  await s.wait(900);
  await accents(true);
  await s.wait(1500);
});

/* ==================================================================== web */
/* Living Web: the Relationship Map row. A drawn copy of Penpoint's Relationships page (RelationshipMap.tsx):
   the cards pop in, Holmes first, then the lines and the group bubbles (no loading screen) -> click Sherlock Holmes ->
   the map slides left as the details panel slides in, his links go dark with label pills, his group bubble deepens ->
   hover a panel row to isolate one relationship -> the orange Story Web rings him and traces his ties.
   Flattened on purpose (Joel 2026-10-17): the map is drawn once, in place, at one zoom; every motion is a CSS transition
   (card pop-in, line and bubble fades, one slide of the whole map). No camera, no per-frame redraw.
   Abstracted: the cast is Holmes and five people (the demo book's 19 cards crowded the small frame), laid out by hand in
   work/web/positions6.json, and the bubble radii are set for this layout (BUB_HUB / BUB_MEMBER) so each group's circles
   overlap into one soft shape as the app's do. The DATA block is written by work/web/data.mjs from the real graph capture. */
(function () {
  // The cards use Inter, which only this scene loads. Fetch it while the page is idle after load, so the relayout
  // its arrival causes lands before a visitor scrolls here instead of mid-scroll (measured: a long task at scene start).
  window.addEventListener('load', function () {
    (window.requestIdleCallback || setTimeout)(function () {
      if (document.fonts) document.fonts.forEach(function (f) { if (f.family.replace(/"/g, '') === 'Inter' && f.status === 'unloaded') f.load(); });
    });
  });
  /*DATA*/
  var Z0 = 0.72, ZF = 0.72, FINAL_HOLMES = [252,252];
  // [id, name, alias, importance, group, color, card width, name box height, overview x, overview y (canvas px at Z0)]
  var NODES = [
    ["watson","Dr. John Watson","Watson, Boswell","Primary",3,"#647486",135.2,55.8,457,440],
    ["adler","Irene Adler","The Woman, Irene Norton","Secondary",1,"#c06931",167.9,55.8,299,440],
    ["hudson","Mrs. Hudson","Martha, Mrs. H","Secondary",3,"#317bc4",111.5,55.8,630,440],
    ["mycroft","Mycroft Holmes","Mycroft, The British Government","Secondary",1,"#b05399",203.4,55.8,317,64],
    ["moriarty","Professor James Moriarty","The Napoleon of Crime, The Professor","Primary",1,"#b09116",234.6,55.8,595,64],
    ["sherlock","Sherlock Holmes","Holmes, Sherlock, Sigerson, Altamont","Primary",1,"#c84042",230.7,55.8,457,252]
  ];
  // [from, to, label, reverse label, two-way]
  var EDGES = [
    ["watson","hudson","Landlord-Tenant","",0],
    ["watson","sherlock","Partner","Friend",1],
    ["mycroft","sherlock","Brother","Brother",1],
    ["moriarty","sherlock","Nemesis","Nemesis",1],
    ["sherlock","adler","Admired","",0],
    ["sherlock","hudson","Landlord-Tenant","",0]
  ];
  // [bubble color, members, hub]
  var GROUPS = [["#c84042",2,"jack-stapleton"],["#5b59d0",7,"sherlock"],["#b09116",2,"count-negretto-sylvius"],["#c43869",5,"sir-henry-baskerville"],["#1f8d8d",2,"eliza-barrymore"],["#c06931",1,"selden"]];
  /*END*/

  var NS = 'http://www.w3.org/2000/svg';
  var MW = 914.67, MH = 520, BG = [255, 247, 230]; // the map: 60 px taller than the app's at this size (no header bar)
  var BUB_HUB = 140, BUB_MEMBER = 110; // bubble radii in map px: just big enough that each group's circles merge into one shape
  // Panel rows in the real app's order (details-panel-rows.json), kept for whoever is in the cast (NODES);
  // direction icon + type text derive from the edge.
  var ROW_IDS = ['moran', 'count-negretto-sylvius', 'watson', 'jack-stapleton', 'mycroft', 'moriarty', 'sam-merton', 'lestrade', 'adler', 'hudson', 'wiggins', 'sir-henry-baskerville'];

  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(h, t, a) {
    var c = rgb(h).map(function (v, i) { return Math.round(v * (1 - t) + BG[i] * t); });
    return a === undefined ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')';
  }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function placeArrow(elm, x0, y0, cx, cy, x1, y1, t) {
    var u = 1 - t;
    var px = u * u * x0 + 2 * u * t * cx + t * t * x1, py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    var tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx), ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    elm.setAttribute('transform', 'translate(' + px.toFixed(2) + ' ' + py.toFixed(2) + ') rotate(' + (Math.atan2(ty, tx) * 180 / Math.PI).toFixed(2) + ')');
  }
  function qpoint(x0, y0, cx, cy, x1, y1, t) {
    var u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
  }
  // The app's curve: a quadratic whose bend grows with length, a little more for two-way links.
  function ctrl(ax, ay, bx, by_, bi) {
    var dx = bx - ax, dy = by_ - ay, d = Math.hypot(dx, dy) || 1;
    var off = Math.min(d * 0.2, 80) * (bi ? 1 : 0.5) * 0.4 + (bi ? 7 : 0);
    return [(ax + bx) / 2 - dy / d * off, (ay + by_) / 2 + dx / d * off];
  }

  LR.scene('web', async function (s) {
    var map = s.$('[data-wb-map]');
    // Cards are drawn at their real size; the map's zoom (ZF) only sets how far apart they sit and their shadow offset.
    map.style.setProperty('--sh', (4 * ZF).toFixed(2) + 'px');

    /* ---------------------------------------------------------------- build the map, once, where it ends up */
    // Everything that slides when Holmes is picked lives in one layer; the details panel stays put.
    var world = document.createElement('div');
    world.className = 'wb-world';
    map.appendChild(world);
    var bubSvg = el('svg', { 'class': 'wb-bub', viewBox: '0 0 ' + MW + ' ' + MH }, world);
    var lkSvg = el('svg', { 'class': 'wb-lk', viewBox: '0 0 ' + MW + ' ' + MH }, world);
    var lksSvg = el('svg', { 'class': 'wb-lks', viewBox: '0 0 ' + MW + ' ' + MH }, world);
    var defs = el('defs', {}, lkSvg);

    // Final spots: the overview layout moved so Holmes sits at FINAL_HOLMES, left of the panel. Before the click the
    // whole layer is shifted back by the same amount, which centers the map.
    var hd = NODES.filter(function (d) { return d[0] === 'sherlock'; })[0];
    var shift = [FINAL_HOLMES[0] - hd[8], FINAL_HOLMES[1] - hd[9]];
    world.style.setProperty('--wx', (-shift[0]) + 'px');
    world.style.setProperty('--wy', (-shift[1]) + 'px');

    var nodes = NODES.map(function (d) {
      var n = { id: d[0], name: d[1], alias: d[2], imp: d[3], grp: d[4], color: d[5], w: d[6], nh: d[7], H: d[7] + 22,
        sx: d[8] + shift[0], sy: d[9] + shift[1] };
      n.vw = n.w; n.vh = n.H; // the card as drawn
      var c = document.createElement('div');
      c.className = 'wb-card pre';
      c.style.width = n.w + 'px'; c.style.height = n.H + 'px';
      c.style.left = (n.sx - n.w / 2).toFixed(2) + 'px'; c.style.top = (n.sy - n.H / 2).toFixed(2) + 'px';
      c.innerHTML = '<div class="wb-nm' + (n.alias ? '' : ' na') + '" style="height:' + n.nh + 'px"><b>' + n.name + '</b>' +
        (n.alias ? '<em>"' + n.alias + '"</em>' : '') + '</div><div class="wb-sc" style="top:' + n.nh + 'px">' + n.imp + '</div>';
      world.appendChild(c);
      n.el = c;
      return n;
    });
    var by = {}; nodes.forEach(function (n) { by[n.id] = n; });
    var holmes = by['sherlock'];

    // group bubbles: one flat circle per member (the hub's larger), drawn as a unit at low alpha so overlaps do not darken
    var groups = GROUPS.map(function (g) {
      var ge = el('g', { fill: g[0] }, bubSvg);
      ge.style.opacity = 0;
      nodes.forEach(function (n) {
        if (GROUPS[n.grp] !== g) return;
        el('circle', { cx: n.sx.toFixed(1), cy: n.sy.toFixed(1), r: n.id === g[2] ? BUB_HUB : BUB_MEMBER }, ge);
      });
      return { el: ge };
    });

    // links: gradient line + direction arrows; Holmes's links also get a dark copy and a label pill for after the click
    var edges = EDGES.map(function (d, i) {
      var e = { a: by[d[0]], b: by[d[1]], label: d[2], rev: d[3], bi: !!d[4], touches: d[0] === 'sherlock' || d[1] === 'sherlock' };
      var ax = e.a.sx, ay = e.a.sy, bx = e.b.sx, by_ = e.b.sy, c = ctrl(ax, ay, bx, by_, e.bi);
      e.c = c;
      var dd = 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by_.toFixed(1);
      var grad = el('linearGradient', { id: 'wbg' + i, gradientUnits: 'userSpaceOnUse', x1: ax, y1: ay, x2: bx, y2: by_ }, defs);
      el('stop', { offset: 0, 'stop-color': e.a.color }, grad); el('stop', { offset: 1, 'stop-color': e.b.color }, grad);
      e.g = el('g', { 'class': 'wb-eg' }, lkSvg);
      el('path', { d: dd, stroke: 'url(#wbg' + i + ')', 'stroke-width': 1 }, e.g);
      placeArrow(el('path', { d: 'M0 0L-8 4.62L-8 -4.62Z', fill: e.b.color }, e.g), ax, ay, c[0], c[1], bx, by_, 1 / 3);
      if (e.bi) placeArrow(el('path', { d: 'M0 0L-8 4.62L-8 -4.62Z', fill: e.a.color }, e.g), ax, ay, c[0], c[1], bx, by_, 2 / 3);
      if (e.touches) {
        e.sg = el('g', { 'class': 'wb-es' }, lksSvg);
        el('path', { d: dd, stroke: '#29241E', 'stroke-width': 2 }, e.sg);
        placeArrow(el('path', { d: 'M0 0L-8 4.62L-8 -4.62Z', fill: '#29241E' }, e.sg), ax, ay, c[0], c[1], bx, by_, 1 / 3);
        if (e.bi) placeArrow(el('path', { d: 'M0 0L-8 4.62L-8 -4.62Z', fill: '#29241E' }, e.sg), ax, ay, c[0], c[1], bx, by_, 2 / 3);
        var pill = document.createElement('div');
        pill.className = 'wb-pill';
        pill.textContent = e.bi && e.rev ? (e.label === e.rev ? e.label : e.label + ' / ' + e.rev) : e.label;
        world.appendChild(pill);
        e.pill = pill;
      }
      return e;
    });

    // Label pills: the app nudges a label off a spot where it collides; here each pill takes the point nearest the middle
    // of its line that is clear of every card and every other pill.
    (function planPills() {
      var boxes = nodes.map(function (n) { return [n.sx - n.vw / 2 - 4, n.sy - n.vh / 2 - 1, n.sx + n.vw / 2 + 1, n.sy + n.vh / 2 + 4]; });
      var placed = [];
      function hit(r, b) { return r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]; }
      // Every pill is shown (opacity 0 until the click) and measured in one pass, so the page lays out once, not once a pill.
      var mine = edges.filter(function (e) { return e.touches; });
      mine.forEach(function (e) { e.pill.style.display = 'block'; });
      mine.forEach(function (e) { e.pw = e.pill.offsetWidth; });
      mine.forEach(function (e) {
        var pw = e.pw, best = null;
        for (var t = 0.1; t <= 0.9; t += 0.02) {
          var q = qpoint(e.a.sx, e.a.sy, e.c[0], e.c[1], e.b.sx, e.b.sy, t), r = [q[0] - pw / 2 - 2, q[1] - 13, q[0] + pw / 2 + 2, q[1] + 13];
          if (r[0] < 3 || r[1] < 3 || r[3] > MH - 3 || r[2] > 505) continue; // inside the map, never under the panel
          if (boxes.some(function (b) { return hit(r, b); }) || placed.some(function (b) { return hit(r, b); })) continue;
          var score = Math.abs(t - 0.5);
          if (!best || score < best.score) best = { score: score, r: r, q: q };
        }
        // A line with no clear stretch goes without a pill; the panel lists its type.
        e.pill.style.display = best ? 'block' : 'none';
        if (!best) return;
        placed.push(best.r);
        e.pill.style.transform = 'translate(' + (best.q[0] - pw / 2).toFixed(1) + 'px,' + (best.q[1] - 12).toFixed(1) + 'px)';
      });
    })();

    /* ---------------------------------------------------------------- the details panel */
    function edgeOf(id) {
      for (var i = 0; i < edges.length; i++) { var e = edges[i]; if (e.touches && (e.a.id === id || e.b.id === id)) return e; }
    }
    var panel = document.createElement('div');
    panel.className = 'wb-panel';
    var rowsHtml = ROW_IDS.filter(function (id) { return by[id] && edgeOf(id); }).map(function (id) {
      var e = edgeOf(id), n = by[id];
      var icon = e.bi ? 'arrow-left-right' : (e.a.id === 'sherlock' ? 'arrow-right' : 'arrow-left');
      var txt = e.bi ? e.label + ' / ' + e.rev : e.label;
      return '<div class="wb-row" data-rel="' + id + '"><span class="nm">' + n.name + (n.alias ? '<i>"' + n.alias + '"</i>' : '') + '</span>' + s.icon(icon) + '<span class="lb">' + txt + '</span></div>';
    }).join('');
    panel.innerHTML = '<div class="wb-ph"><div><h3>Sherlock Holmes</h3><p class="al">"' + holmes.alias + '"</p><p>' + holmes.imp + '</p></div>' +
      '<div class="wb-px">' + s.icon('x') + '</div></div><div class="wb-pb"><h4>Relationships</h4>' + rowsHtml + '</div>';
    map.appendChild(panel);

    // Card colors for a fade level (0 none .. 1 full), the app's blend: 90% of the level toward the page color.
    function fadeNode(n, L) {
      var st = n.el.style;
      st.setProperty('--nb', mix('#29241E', 0.9 * L)); st.setProperty('--nt', mix('#FEF9F0', 0.9 * L));
      st.setProperty('--at', mix('#FEF9F0', 0.9 * L, 0.7)); st.setProperty('--sb', mix('#EBDCC8', 0.9 * L));
      st.setProperty('--st', mix('#7D5D35', 0.9 * L)); st.setProperty('--sa', (0.2 - 0.1 * L).toFixed(3));
    }
    function connectedTo(id) {
      var set = {}; set[id] = true;
      edges.forEach(function (e) { if (e.a.id === id) set[e.b.id] = true; if (e.b.id === id) set[e.a.id] = true; });
      return set;
    }

    /* ---------------------------------------------------------------- story */
    await s.wait(350);

    // 1. the map appears: cards pop in (Holmes first, then outward), then the lines, then the group bubbles
    var order = nodes.slice().sort(function (a, b) {
      return Math.hypot(a.sx - holmes.sx, a.sy - holmes.sy) - Math.hypot(b.sx - holmes.sx, b.sy - holmes.sy);
    });
    order.forEach(function (n, i) {
      if (s.instant) n.el.classList.remove('pre');
      else s.later(function () { n.el.classList.remove('pre'); }, i * 110);
    });
    await s.wait(450);
    lkSvg.classList.add('on');
    await s.wait(450);
    groups.forEach(function (g) { g.el.style.opacity = 0.25; });
    await s.wait(1500);

    // 2. the pointer picks Sherlock Holmes, then clicks
    await s.pointer.to(holmes.el, { fx: 0.5, fy: 0.3, dur: 1100 });
    await s.wait(500);
    await s.pointer.click();

    // 3. selected: the map slides left as the panel slides in; his links go dark with labels, the other line pulls back
    var conn = connectedTo('sherlock');
    nodes.forEach(function (n) {
      fadeNode(n, conn[n.id] ? 0 : 1);
      if (conn[n.id]) n.el.classList.add('cn');
    });
    edges.forEach(function (e) {
      if (e.touches) { e.g.style.opacity = 0; e.sg.style.opacity = 1; }
      else e.g.style.opacity = 0.2;
    });
    groups[holmes.grp].el.style.opacity = 0.45; // the app deepens it to .625; over this much area that reads too heavy
    world.classList.add('sel');
    panel.classList.add('on');
    await s.wait(400);
    edges.forEach(function (e) { if (e.pill) e.pill.style.opacity = 1; });
    await s.wait(1900);

    // 4. hover one relationship in the panel: that card stays full strength, his other connections dim
    var row = s.$('.wb-row[data-rel="watson"]');
    await s.pointer.to(row, { fx: 0.45, fy: 0.5, dur: 900 });
    row.classList.add('hv');
    nodes.forEach(function (n) { fadeNode(n, n.id === 'sherlock' || n.id === 'watson' ? 0 : (conn[n.id] ? 0.8 : 1)); });
    edges.forEach(function (e) { if (e.touches) e.sg.style.opacity = (e.a.id === 'watson' || e.b.id === 'watson') ? 1 : 0.2; });
    await s.wait(1400);
    row.classList.remove('hv');
    nodes.forEach(function (n) { fadeNode(n, conn[n.id] ? 0 : 1); });
    edges.forEach(function (e) { if (e.touches) e.sg.style.opacity = 1; });
    s.pointer.hide();
    await s.wait(500);

    // 5. the orange Story Web: ring him and trace his ties; both fade, so the map rests clean (the still frame has neither)
    s.ring(holmes.el, { pad: 7, cls: 'heavy', hold: 3200 });
    await s.wait(500);
    // Trace each of his lines outward from his card, over the stretch that shows between cards (map px -> stage px).
    var mapOff = s.rel(map);
    function inRect(q, n) { return Math.abs(q[0] - n.sx) < n.vw / 2 && Math.abs(q[1] - n.sy) < n.vh / 2; }
    function tracePath(e) {
      var rev = e.b === holmes, pts = [], started = false;
      for (var i = 0; i <= 100; i++) {
        var t = rev ? 1 - i / 100 : i / 100, q = qpoint(e.a.sx, e.a.sy, e.c[0], e.c[1], e.b.sx, e.b.sy, t);
        if (!started) { if (!inRect(q, holmes)) { started = true; pts.push(q); } continue; }
        if (nodes.some(function (n) { return n !== holmes && inRect(q, n); })) break;
        pts.push(q);
      }
      if (pts.length < 3) return null;
      return 'M' + pts.map(function (q) { return (q[0] + mapOff.x).toFixed(1) + ',' + (q[1] + mapOff.y).toFixed(1); }).join(' L');
    }
    var ti = 0;
    edges.forEach(function (e) {
      if (!e.touches) return;
      var d = tracePath(e);
      if (!d) return;
      s.later(function () { s.path(d, { dur: 700, hold: 1700, cls: 'thick' }); }, ti++ * 110);
    });
    await s.wait(3600); // the ring and the traces have faded
  });
})();

/* ==================================================================== import */
/* "Name Finder" (Import & Scan row). Story (about 12 s, rests on the results):
     0.0  Manuscript Mode, chapter 9 of the Sherlock demo book, at the end of the draft.
     0.6  The writer types the next line: "Well, Watson, what do you make of it?" (the word count ticks up).
     3.4  Pointer right-clicks the book title: the real "Scan Manuscript for Content" menu; click.
     4.9  The real Manuscript Scanner: scanning step (spinner, eased progress with its stall, 2.5 s like the app).
     7.6  The real results (captured live): Scanned 9 chapters, 7,198 words, Matches Found (22); the found entries
          cascade down the list one after another.
     9.0  Orange ring on the count + underlines on three names from the page. Rests there; Still / reduced motion
          lands on the same frame. */
LR.scene('import', async function (s) {
  var $ = s.$, $$ = s.$$;
  var dim = $('.im-dim'), scan = $('.im-dlg--scan'), res = $('.im-dlg--res'), menu = $('.im-menu'), mi = $('.im-mi');
  var bar = $('.im-bar i'), inner = $('.im-inner'), typed = $('[data-typed]');
  // The header clock shows the visitor's own time, like the app's.
  $('.pa-clock span').textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  function showResults() { dim.classList.add('on'); scan.classList.remove('on'); res.classList.add('on'); }

  // The orange marks that rest on the results (also drawn in the still frame).
  // The ring says "22 found"; the underlines pick out names from the page the writer was just on.
  var ECHO = [0, 1, 5]; // Sherlock Holmes, Dr. John Watson, Dr. James Mortimer (rows of Matches Found)
  async function accents(animate) {
    var head = $('.im-dlg--res .im-sec .im-sti');
    s.ring(head, { pad: 7, dur: 650, still: true, cls: 'thick' });
    if (animate) await s.wait(750);
    for (var k = 0; k < ECHO.length; k++) {
      s.underline($('.im-row[data-i="' + ECHO[k] + '"] .im-t'), { dur: 420, still: true });
      if (animate) await s.wait(330);
    }
  }

  if (s.instant) { showResults(); await accents(false); return; }

  /* ---- 1. the writer types the next line; the footer's word counts follow ---- */
  var LINE = typed.textContent;
  var words = $('[data-words]'), total = $('[data-total]');
  var W_END = 1720, T_END = 7198, N = LINE.trim().split(/\s+/).length;
  function count(n) {
    words.textContent = (W_END - N + n).toLocaleString('en-US');
    total.textContent = (T_END - N + n).toLocaleString('en-US');
  }
  typed.textContent = '';
  var caret = s.caret();
  typed.appendChild(caret);
  count(0);
  await s.wait(600);
  await s.type(typed, LINE, {
    min: 28, spread: 34, punct: 170,
    onChar: function (ch, node) { if (ch === ' ') count(node.data.trim().split(/\s+/).length); }
  });
  count(N);
  await s.wait(650);

  /* ---- 2. Scan Manuscript for Content (right-click the book title) ---- */
  await s.pointer.to({ x: 76, y: 100 }, { dur: 850 });
  await s.wait(120);
  await s.pointer.click();
  if (caret.parentNode) caret.parentNode.removeChild(caret); // the editor loses focus to the menu
  menu.classList.add('on');
  await s.wait(300);
  await s.pointer.to(mi, { fx: 0.55, fy: 0.55, dur: 520 });
  mi.classList.add('hov');
  await s.wait(260);
  await s.pointer.click();
  menu.classList.remove('on'); mi.classList.remove('hov');
  s.pointer.hide();
  await s.wait(180);

  /* ---- 3. the scanning step (progress as the app animates it: ease-out with a stall) ---- */
  dim.classList.add('on'); scan.classList.add('on');
  var t = 0;
  var ticker = s.every(function () {
    t += 40;
    var u = Math.min(t / 2500, 1), e = 1 - Math.pow(1 - u, 3);
    if (u > 0.4 && u < 0.65) e -= 0.08 * Math.sin(((u - 0.4) / 0.25) * Math.PI);
    bar.style.width = Math.round(Math.max(0, e) * 100) + '%';
  }, 40);
  await s.wait(2500);
  clearInterval(ticker); // the scan is done: stop the progress ticker
  bar.style.width = '100%';
  await s.wait(200);

  /* ---- 4. the results: the dialog lands empty, then the found entries cascade down the list ---- */
  inner.classList.add('im-cas');
  scan.classList.remove('on'); res.classList.add('on');
  await s.wait(220);
  // Delays go on only now: set before the rows hid, they would also have held back the hiding.
  $$('.im-sh, .im-row').forEach(function (el, k) { el.style.transitionDelay = Math.min(k, 12) * 70 + 'ms'; }); // past row 12 is out of view
  inner.classList.add('im-cas-go');
  await s.wait(12 * 70 + 450);

  /* ---- 5. rest: orange marks tie the count together ---- */
  await accents(true);
  await s.wait(1300);
});

/* ==================================================================== series */
/* "Shelf Grows" (Series row). Story (about 13 s, rests on the full shelf and its shared world):
     0.0  Your Books: one painted Book and the dashed "Create New Book" card. Caption: "Your Book Library".
     0.4  The pointer goes straight to the card's three-dot menu (the card takes its hover pose) and opens it.
          The menu and the dialog are drawn about 2.5x the app's size and trimmed (abstracted so they read on a small figure).
     1.6  "Convert to Series…": hover fill + a quick orange ring, click.
     2.8  The Convert to Series dialog appears at once; "Sherlock Holmes" is typed (15/100, the button wakes up);
          Convert: "Converting…", then dialog and dim vanish in one frame.
     5.0  The shelf: second bar fades in, Book 1 fades in. Caption: "Your Series Shelf". An orange thread starts as a dot under Book 1.
     6.2  Time passes (6.2, 7.3, 8.4): A Study in Scarlet, The Sign of Four, The Hound of the Baskervilles land in their
          places one at a time and the thread stretches to each (no Add card, nothing slides).
     9.7  Everything a series shares drops out of the thread: Characters, Locations, Items, Notebook, Series Arcs,
          then "Shared by all books" (bold).
     Still / reduced motion lands on the same last frame. */
LR.scene('series', async function (s) {
  var $ = s.$;
  var libView = $('.se-view-lib'), shelf = $('[data-shelf]'), bar = $('.se-bar');
  var libCard = $('[data-lib-card]'), kebab = libCard.querySelector('.se-kbb'), menu = $('.se-menu'), conv = $('.se-mi-conv');
  var dim = $('.se-dim'), dlg = $('.se-dlg'), nameBox = $('[data-name]'), go = $('[data-go]'), cnt = $('[data-cnt]');
  var ph = nameBox.querySelector('.se-ph');
  var b = [null, $('[data-book="1"]'), $('[data-book="2"]'), $('[data-book="3"]'), $('[data-book="4"]')];
  var thr = $('.se-thr'), brs = s.$$('.se-br'), chips = s.$$('.se-chip'), shared = $('.se-shared');
  var landed = [], dots = [];

  // Run fn after ms (at once for reduced motion / Still).
  function after(fn, ms) { if (s.instant) fn(); else s.later(fn, ms); }
  function cx(el) { return el.offsetLeft + el.offsetWidth / 2; }
  function threadY() { return b[1].offsetTop + b[1].offsetHeight + 16; }

  /* ---- the orange thread: a line in the gap under the row with a dot under each Book's center ---- */
  function layoutThread() {
    var y = threadY(), x0 = cx(landed[0]);
    thr.classList.remove('se-off');
    thr.style.top = y + 'px';
    thr.style.left = x0 + 'px';
    thr.style.width = (cx(landed[landed.length - 1]) - x0) + 'px';
    landed.forEach(function (el, i) {
      if (dots[i]) return;
      var d = dots[i] = document.createElement('i');
      d.className = 'se-dot pre';
      d.style.top = y + 'px';
      d.style.left = cx(el) + 'px';
      thr.parentNode.appendChild(d);
      void d.offsetWidth;
      after(function () { d.classList.remove('pre'); }, i === 0 ? 0 : 380); // the line reaches the Book first, then the dot lands
    });
  }

  /* ---- the shared world: one trunk drops from the middle of the thread to a branch bar, which splits to each
     thing every Book shares (the trunk lands on the middle chip's branch, so every joint lines up) ---- */
  var trunk = $('.se-trunk'), bus = $('.se-bus');
  function placeWorld() {
    var y = threadY(), x0 = cx(b[1]), x4 = cx(b[4]), stem = 58, drop = 120, n = chips.length;
    trunk.style.left = (x0 + x4) / 2 + 'px'; trunk.style.top = y + 'px'; trunk.style.height = stem + 'px';
    bus.style.left = x0 + 'px'; bus.style.width = (x4 - x0) + 'px'; bus.style.top = (y + stem) + 'px';
    chips.forEach(function (c, i) {
      var x = x0 + i * (x4 - x0) / (n - 1);
      brs[i].style.left = x + 'px'; brs[i].style.top = (y + stem) + 'px'; brs[i].style.height = (drop - stem) + 'px';
      c.style.left = x + 'px'; c.style.top = (y + drop) + 'px';
    });
    shared.style.top = (y + drop + 128 + 40) + 'px';
  }
  function showWorld() {
    var mid = (chips.length - 1) / 2;
    after(function () { trunk.classList.add('on'); }, 0);
    after(function () { bus.classList.add('on'); }, 240);                 // grows out from the middle
    brs.forEach(function (br, i) {
      var t = 520 + Math.abs(i - mid) * 110;                              // branches drop as the bar reaches them
      after(function () { br.classList.add('on'); }, t);
      after(function () { chips[i].classList.add('on'); }, t + 200);
    });
    after(function () { shared.classList.add('on'); }, 520 + mid * 110 + 650);
  }

  /* ---- the shelf appears (straight cut + fade-in, like the app after Convert) ---- */
  function showShelf() {
    libView.classList.add('se-off');
    shelf.classList.remove('se-off');
    bar.classList.remove('se-off');
    placeWorld();
  }
  function land(book) {
    book.classList.remove('se-wait');
    book.classList.add('se-fade'); // opacity only, 0.6 s, like the app
    landed.push(book);
    layoutThread();
  }

  s.caption('Your Book Library');
  if (s.instant) {
    showShelf();
    for (var k = 1; k <= 4; k++) land(b[k]);
    showWorld();
    s.caption('Your Series Shelf');
    return;
  }

  /* ---- 1. the Library: the pointer goes straight to the card's menu ---- */
  await s.wait(400);
  await s.pointer.to(kebab, { dur: 800 });
  libCard.classList.add('hov'); kebab.classList.add('hov');
  await s.wait(200);
  await s.pointer.click();
  menu.classList.add('on');
  await s.wait(350);

  /* ---- 2. Convert to Series…: hover, a quick orange ring, click ---- */
  await s.pointer.to(conv, { fx: 0.45, dur: 450 });
  conv.classList.add('hov');
  var ring = s.ring(conv, { pad: 8, dur: 500, cls: 'heavy' });
  await s.wait(900);
  ring.fade();
  await s.wait(150);
  await s.pointer.click();
  menu.classList.remove('on'); conv.classList.remove('hov'); kebab.classList.remove('hov'); libCard.classList.remove('hov');
  dim.classList.add('on'); dlg.classList.add('on'); // dialogs have no animation in the app

  /* ---- 3. the dialog: name the series ---- */
  await s.wait(450);
  await s.type(nameBox, 'Sherlock Holmes', {
    min: 40, spread: 35,
    onChar: function (ch, node) {
      ph.style.display = 'none';
      cnt.textContent = node.data.length + '/100';
      go.classList.remove('dis');
    }
  });
  await s.wait(300);
  await s.pointer.to(go, { dur: 500 });
  await s.wait(80);
  await s.pointer.click();
  go.textContent = 'Converting…';
  dlg.classList.add('busy');
  await s.wait(320);
  dim.classList.remove('on'); dlg.classList.remove('on'); // one frame, no fade
  s.pointer.hide();

  /* ---- 4. the shelf ---- */
  showShelf();
  s.caption('Your Series Shelf');
  b[1].classList.remove('se-wait'); b[1].classList.add('se-fade');
  await s.wait(700);
  landed.push(b[1]);
  layoutThread(); // a dot under Book 1
  await s.wait(500);

  /* ---- 5. time passes: three more Books land in their places ---- */
  for (var i = 2; i <= 4; i++) {
    land(b[i]);
    await s.wait(650); // Joel 2026-10-18: was 1100
  }
  await s.wait(350);

  /* ---- 6. everything they share ---- */
  showWorld();
  await s.wait(2200);
});

/* ==================================================================== backups */
/* Living Rows scene "backups" (Backups row, "The Wi-Fi drops. You keep writing.").
   Story (about 15 s, plays once, rests on its last frame):
     1. Manuscript Mode: the writer types; the Saved chip does its usual Saving... / Saved.
     2. An orange Wi-Fi symbol (a drawn-over abstraction, not app UI) loses its signal and gets struck through.
        The chip keeps saying Saved and the writing carries on: nothing changes, which is the point.
     3. The book backs itself up (chip: Backing up..., the app's own wording), then Settings > Storage & Backups
        fades in: Automatic Backups says "Last Backup: Just now". The struck Wi-Fi mark slides up beside the title.
     4. An orange line carries a copy of that backup to the Secondary Backup folder on Google Drive; the secondary
        folder's own counter ticks from 8 to 9 backups. Final frame = that page with the line and the rings.
   Real app UI: everything inside the window. Abstractions: the orange Wi-Fi mark, rings, the line and the little
   "copy" token that rides it. Instant mode (reduced motion / Still) lands on the same final frame. */
LR.scene('backups', async function (s) {
  var $ = s.$, ICONS = s.iconHref('');
  var stage = s.stage;
  var ORANGE = '#CD6E2C';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var live = $('[data-live]');
  var wordsEl = $('[data-words]'), totalEl = $('[data-total]');
  var chipIcWrap = $('[data-chip-ic]'), chipIc = $('[data-chip-ic] use'), chipT = $('[data-chip-t]'), chipEl = $('[data-chip]');
  var sc = $('[data-sc]'), sbThumb = $('[data-sbar] i');
  var words = 435, total = 7191, saveTimer = null;

  /* ---- the header clock shows the visitor's own time, like the app's ---- */
  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var t = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    s.$$('[data-clock]').forEach(function (c) { c.textContent = t; });
  }
  tick(); s.every(tick, 20000);

  /* ---- the Saved chip: static glyph (never a spinner), word slot sized by "Saving..." like the app's ---- */
  function chip(word, icon) {
    chipT.textContent = word;
    var next = ICONS + icon;
    if (chipIc.getAttribute('href') !== next) {
      chipIc.setAttribute('href', next);
      chipIcWrap.classList.remove('in'); void chipIcWrap.getBoundingClientRect(); chipIcWrap.classList.add('in'); // 200 ms fade-in, as the app cross-fades its glyph
    }
  }
  function saving() {
    clearTimeout(saveTimer);
    chip('Saving...', 'refresh-cw');
    saveTimer = s.later(function () { chip('Saved', 'check'); }, 1100);
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function onChar(ch) {
    if (ch === ' ') { words++; total++; wordsEl.textContent = words; totalEl.textContent = fmt(total); }
    saving();
  }
  var TYPE = { min: 20, spread: 26, punct: 140, onChar: onChar };

  /* ---- the orange Wi-Fi mark (drawn over the window; the dot of the symbol sits at WX,WY) ---- */
  var WX = 924, WY = 172;            // in the page's right margin while the writer types
  var CORNER = { x: 913, y: 128, k: 0.88 }; // beside the title once Storage & Backups is up
  function el(tag, attrs, parent) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); (parent || s.web).appendChild(n); return n; }
  function arc(r) {
    var a = 50 * Math.PI / 180, dx = r * Math.sin(a), dy = r * Math.cos(a);
    return 'M' + (WX - dx) + ',' + (WY - dy) + ' A' + r + ',' + r + ' 0 0 1 ' + (WX + dx) + ',' + (WY - dy);
  }
  function fade(n, o, ms) { n.style.transition = 'opacity ' + ms + 'ms cubic-bezier(.4,0,.2,1)'; n.style.opacity = o; }
  var wf = null;
  function wifiBuild() {
    var g = el('g', { 'class': 'bk-wfg' });
    var w = { g: g, dot: el('circle', { cx: WX, cy: WY, r: 5.5 }, g), arcs: [] };
    [17, 34, 51].forEach(function (r) { w.arcs.push(el('path', { d: arc(r), 'class': 'bk-wf' }, g)); });
    w.all = [w.dot].concat(w.arcs);
    w.strike = el('path', { d: 'M' + (WX - 46) + ',' + (WY - 56) + ' L' + (WX + 46) + ',' + (WY + 10), 'class': 'bk-wf-strike' }, g);
    w.strike.style.opacity = 0;
    return w;
  }
  function wifiCorner() { // slide the mark to its corner (scaled about the web's origin, so the dot lands on CORNER)
    var tx = CORNER.x - WX * CORNER.k, ty = CORNER.y - WY * CORNER.k;
    wf.g.style.transformOrigin = '0 0';
    wf.g.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + CORNER.k + ')';
  }
  function wifiIn() { // signal comes up: dot, then the three arcs
    wf.all.forEach(function (n) { n.style.opacity = 0; });
    wf.all.forEach(function (n, i) { s.later(function () { fade(n, 1, 260); }, i * 130); });
  }
  function wifiDrop() { // signal falls away from the outside in, then the strike goes through it
    [3, 2, 1].forEach(function (i, k) { s.later(function () { fade(wf.arcs[i - 1], 0.2, 380); }, k * 300); });
    s.later(function () {
      fade(wf.dot, 0.5, 300);
      var p = wf.strike, len = p.getTotalLength();
      p.style.opacity = 1; p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect();
      p.style.transition = 'stroke-dashoffset 450ms cubic-bezier(.4,0,.2,1)';
      p.style.strokeDashoffset = 0;
    }, 1000);
  }

  /* ================= Part 1: writing, and the Wi-Fi drops ================= */
  wf = wifiBuild();
  var fades = s.$$('[data-fade]');
  if (!s.instant) { // animated play: Wi-Fi mark starts invisible, Storage cards wait to cascade in
    wf.all.forEach(function (n) { n.style.opacity = 0; });
    fades.forEach(function (f) { f.classList.add('bk-hide'); });
  } else {          // still frame: build the mark in its resting state
    wf.arcs.forEach(function (a) { a.style.opacity = 0.2; });
    wf.dot.style.opacity = 0.5; wf.strike.style.opacity = 1;
  }

  await s.wait(300);
  if (!s.instant) s.later(function () { wifiIn(); }, 1000);  // the symbol comes up while the first sentence is still being typed
  await s.type(live, 'I was aware that by anything of interest, Holmes meant anything of criminal interest.', TYPE);
  if (!s.instant) wifiDrop();
  await s.wait(1250);                       // the writer pauses; the chip settles back to Saved
  if (!s.instant) s.ring(chipEl, { pad: 4, cls: 'thick', dur: 520, hold: 1100 });
  await s.wait(1250);
  await s.type(live, ' There was the news of a revolution,', TYPE);
  await s.wait(1200);                       // Saved again; the Wi-Fi is still down

  /* ================= Part 2: the book backs itself up ================= */
  clearTimeout(saveTimer);
  chip('Backing up...', 'refresh-cw');
  await s.wait(1100);
  chip('Saved', 'check');
  await s.wait(350);

  /* ================= Part 3: Storage & Backups ================= */
  $('[data-ms]').classList.add('bk-out');
  $('[data-st]').classList.add('bk-in');
  if (!s.instant) { wf.g.style.transition = 'transform .9s cubic-bezier(.4,0,.2,1)'; wf.g.getBoundingClientRect(); }
  wifiCorner();
  await s.wait(380);
  fades.forEach(function (f, i) { s.later(function () { f.classList.remove('bk-hide'); }, i * 90); });
  await s.wait(700);
  // Scroll the page down to the two backup cards (the scrollbar thumb travels with it).
  sc.style.transform = 'translateY(-300px)';
  sbThumb.style.transform = 'translateY(102px)';
  await s.wait(1250);

  var last = $('[data-last]'), pathBox = $('[data-path]');
  s.ring(last, { pad: 7, cls: 'thick', dur: 520, still: true });
  await s.wait(700);

  // The orange line carries a copy of that backup to the secondary folder.
  var line = s.line(last, pathBox, { from: 'right', to: 'left', gap: 12, bend: 0.5, cls: 'thick', dur: 1000, still: true });
  await s.wait(300);
  if (!s.instant && line.el) await ride(line.el);
  else await s.wait(1100);

  // The secondary folder's own counter ticks up: its copy has landed.
  $('[data-sec-mb]').textContent = '37 MB';
  $('[data-sec-n]').textContent = '9';
  if (!s.instant) { var sec = $('[data-sec]'); sec.classList.add('bk-flash'); }
  s.ring(pathBox, { pad: 5, cls: 'thick', dur: 520, still: true });
  driveTag(pathBox);
  await s.wait(1400);

  /* A small orange label naming the folder's service (an overlay, like the ring). Plain text, no box, so it never
     fuses with the ring: it sits on the "Secondary Location:" line, on that label's baseline, flush with the field's right edge. */
  function driveTag(box) {
    var b = s.rel(box), lb = box.previousElementSibling, probe = document.createElement('span'); // lb = "Secondary Location:"
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    lb.appendChild(probe);
    var base = s.rel(probe).y;
    lb.removeChild(probe);
    var g = el('g', { 'class': 'bk-tag' });
    var t = document.createElementNS(SVGNS, 'text');
    [['x', b.x + b.w], ['y', base], ['text-anchor', 'end']].forEach(function (a) { t.setAttribute(a[0], a[1]); });
    t.textContent = 'GOOGLE DRIVE';
    g.appendChild(t);
    if (!s.instant) { g.style.opacity = 0; g.style.transition = 'opacity .35s ease'; g.getBoundingClientRect(); s.later(function () { g.style.opacity = 1; }, 300); }
  }

  /* A small "copy" token rides the orange line from the backup to the folder. */
  async function ride(path) {
    var len = path.getTotalLength();
    var g = el('g', { 'class': 'bk-copy' });
    function child(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); g.appendChild(n); }
    child('rect', { x: -8, y: -10, width: 16, height: 20, fill: '#FFF7E6', stroke: ORANGE, 'stroke-width': 2 });
    child('path', { d: 'M-4,-4 H4 M-4,0 H4 M-4,4 H1', stroke: ORANGE, 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' });
    var p0 = path.getPointAtLength(0);
    g.setAttribute('transform', 'translate(' + p0.x + ',' + p0.y + ')');
    g.style.opacity = 0; g.style.transition = 'opacity .25s ease';
    await s.frameTick(); g.style.opacity = 1;
    var t0 = performance.now(), dur = 1100;
    var timer = s.every(function () {
      var k = Math.min(1, (performance.now() - t0) / dur);
      var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      var p = path.getPointAtLength(len * e);
      g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
    }, 16);
    await s.wait(dur + 60);
    clearInterval(timer);
    g.style.opacity = 0;
    s.later(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 400);
  }
});
