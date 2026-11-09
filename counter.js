/*
 * site-visit-counter, the page side. One script tag on every page:
 *
 *   <script src="/visits/counter.js" defer></script>
 *
 * It sends short notes to the Worker it was loaded from (…/visits/hit): the page
 * that was opened, the site the visitor came from, the link tag (?src=,
 * utm_source or ref), phone / tablet / computer, seconds the page was on screen,
 * clicks on tel: and mailto: links, forms marked data-count, and videos marked
 * data-count. No cookies, nothing stored in the browser, no outside service.
 *
 * Nothing is sent when the browser asks not to be followed (Do Not Track or
 * Global Privacy Control), for test robots, or after this browser opened any
 * page with ?notrack=1 (how you keep your own visits out; ?notrack=0 undoes it).
 *
 * On a missing page (404), add data-missing to the script tag or to <html>.
 * Anything else: window.visitCounter.count('type', 'name'), e.g. after a form
 * was really sent: visitCounter.count('form_sent', 'contact').
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.visitCounter) return;
  var endpoint = new URL('hit', script.src).href;
  var OPT_OUT = 'visit-counter:notrack';

  var off = (function () {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || navigator.webdriver) return true;
    try {
      var asked = new URLSearchParams(location.search).get('notrack');
      if (asked === '1') localStorage.setItem(OPT_OUT, '1');
      if (asked === '0') localStorage.removeItem(OPT_OUT);
      return localStorage.getItem(OPT_OUT) === '1';
    } catch (error) {
      return false; // storage blocked: the switch cannot be kept, the visit is counted
    }
  })();

  var view = '';
  var shown = 0; // milliseconds on screen in this view
  var since = 0; // when it last came on screen, 0 while hidden
  var counted = {};
  var videos = [];

  function newId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '', bytes = crypto.getRandomValues(new Uint8Array(16));
    for (var i = 0; i < bytes.length; i++) out += chars[bytes[i] % 36];
    return out;
  }

  function send(note) {
    var body = JSON.stringify(note);
    try {
      // A beacon still goes out while the page is closing.
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
    } catch (error) {
      // fetch below
    }
    try {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (error) {
      // nothing more to try
    }
  }

  function device() {
    var short = Math.min(screen.width, screen.height);
    if (short < 600) return 'phone';
    if (navigator.maxTouchPoints > 0 && short < 1100 && !matchMedia('(pointer: fine)').matches) return 'tablet';
    return 'computer';
  }

  function begin() {
    view = newId();
    shown = 0;
    since = document.visibilityState === 'visible' ? performance.now() : 0;
    counted = {};
    videos = [];
    var query = new URLSearchParams(location.search);
    var missing = script.hasAttribute('data-missing') || document.documentElement.hasAttribute('data-missing');
    send({
      t: 'v',
      id: view,
      p: location.pathname,
      r: document.referrer,
      s: query.get('src') || query.get('utm_source') || query.get('ref') || '',
      d: device(),
      x: missing ? 1 : 0
    });
  }

  function report() {
    if (!view) return;
    if (since) {
      shown += performance.now() - since;
      since = 0;
    }
    send({
      t: 'a',
      id: view,
      s: Math.round(shown / 1000),
      v: videos.map(function (v) { return { n: v.name, p: Math.round(v.best * 100) }; })
    });
  }

  /** Something worth knowing happened; each type and name counts once per page view. */
  function count(type, name) {
    name = String(name || '').slice(0, 80);
    if (off || !view || !/^[a-z0-9_]{1,32}$/.test(type) || counted[type + '|' + name]) return;
    counted[type + '|' + name] = true;
    send({ t: 'e', id: view, e: type, n: name });
  }

  /** A video the visitor is watching: counted once, with how far they got. */
  function watch(video, name) {
    if (off || !view) return;
    for (var i = 0; i < videos.length; i++) if (videos[i].video === video) return;
    var file = (video.currentSrc || video.src || '').split('/').pop().split('?')[0];
    var entry = { video: video, name: String(name || video.getAttribute('data-count') || file || 'video').slice(0, 80), best: 0 };
    videos.push(entry);
    count('video', entry.name);
    follow(video);
  }

  function follow(video) {
    if (video.__visitCounter) return;
    video.__visitCounter = true;
    video.addEventListener('timeupdate', function () {
      // Three seconds of playing is watching, not passing by.
      if (video.currentTime >= 3) watch(video);
      for (var i = 0; i < videos.length; i++) {
        if (videos[i].video === video && video.duration > 0 && isFinite(video.duration)) {
          videos[i].best = Math.max(videos[i].best, Math.min(1, video.currentTime / video.duration));
        }
      }
    });
    video.addEventListener('ended', function () {
      for (var i = 0; i < videos.length; i++) if (videos[i].video === video) videos[i].best = 1;
    });
  }

  window.visitCounter = { count: count, watch: watch };
  if (off) return;

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href^="tel:"], a[href^="mailto:"]');
    var href = link && link.getAttribute('href');
    if (!href) return;
    if (href.indexOf('tel:') === 0) count('phone', href.slice(4));
    else count('email', href.slice(7).split('?')[0].toLowerCase());
  }, true);
  document.addEventListener('focusin', function (event) {
    var form = event.target && event.target.closest && event.target.closest('form[data-count]');
    if (form) count('form_start', form.getAttribute('data-count'));
  }, true);
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form && form.matches && form.matches('form[data-count]')) count('form_submit', form.getAttribute('data-count'));
  }, true);
  // Media events do not bubble, but they pass the document on the way down.
  document.addEventListener('play', function (event) {
    if (event.target && event.target.matches && event.target.matches('video[data-count]')) follow(event.target);
  }, true);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') report();
    else if (!since) since = performance.now();
  });
  window.addEventListener('pagehide', report);
  // Back to a page the browser kept in memory: a new view of it.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) begin();
  });
  // A page the browser opened ahead of time is counted only once it is shown.
  if (document.prerendering) document.addEventListener('prerenderingchange', begin, { once: true });
  else begin();
})();
