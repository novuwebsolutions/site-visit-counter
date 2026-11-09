// site-visit-counter dashboard: asks the Worker for the numbers (…/visits/data) with the key
// you set as STATS_TOKEN, and draws them. The key is kept in this browser only, until you
// press "Forget". Estonian when the browser prefers it, English otherwise.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var et = /^et\b/i.test(navigator.language || '');
  var T = et ? {
    title: 'Külastused', key: 'Vaate võti (STATS_TOKEN)', open: 'Ava', wrong: 'Vale võti.', failed: 'Numbreid ei saanud laadida.',
    forget: 'Unusta võti selles seadmes', days: { 7: '7 päeva', 30: '30 päeva', 365: '12 kuud' },
    period: { 7: 'viimase 7 päeva jooksul', 30: 'viimase 30 päeva jooksul', 365: 'viimase 12 kuu jooksul' },
    visitors: 'Külastajad', visitorsSub: 'üks inimene kord päevas', views: 'Lehevaatamised', perVisitor: 'lehte külastaja kohta',
    time: 'Keskmine aeg lehel', timeSub: 'nii kaua oli leht ekraanil', contacts: 'Klõpsud telefonil ja e-postil', forms: 'Saadetud vormid',
    perDay: 'Külastajad päevas', perMonth: 'Külastajad kuus', none: 'Selle aja kohta veel andmeid pole.',
    lists: { pages: 'Lehed', sources: 'Kust tulid', tags: 'Lingi sildid (?src=)', devices: 'Seadmed', countries: 'Riigid', videos: 'Videod', events: 'Sündmused', missing: 'Puuduvad lehed (404)' },
    direct: 'Otse (aadress, järjehoidja või rakendus)', device: { phone: 'Telefon', tablet: 'Tahvel', computer: 'Arvuti' },
    watched: 'vaadati keskmiselt', tagsEmpty: 'Lisa lingile ?src=nimi (näiteks ?src=facebook) ja näed siin, mitu inimest selle kaudu tuli.',
    help: 'Üks inimene on üks külastaja päevas. Üksikud külastused kustuvad pärast KEEP_DAYS päeva, alles jäävad päevased numbrid. Oma külastuste lugemise lõpetamiseks ava oma lehel kord ?notrack=1 (tagasi: ?notrack=0).',
    event: { phone: 'Klõps telefonil', email: 'Klõps e-postil', form_start: 'Vormi täitmist alustati', form_submit: 'Vorm saadeti', form_sent: 'Vorm saadeti' },
    visitorsWord: ['külastaja', 'külastajat'], locale: 'et-EE'
  } : {
    title: 'Visits', key: 'Dashboard key (STATS_TOKEN)', open: 'Open', wrong: 'Wrong key.', failed: 'Could not load the numbers.',
    forget: 'Forget the key on this device', days: { 7: '7 days', 30: '30 days', 365: '12 months' },
    period: { 7: 'in the last 7 days', 30: 'in the last 30 days', 365: 'in the last 12 months' },
    visitors: 'Visitors', visitorsSub: 'one person once a day', views: 'Page views', perVisitor: 'pages per visitor',
    time: 'Average time on a page', timeSub: 'how long the page was on screen', contacts: 'Phone and e-mail clicks', forms: 'Forms sent',
    perDay: 'Visitors per day', perMonth: 'Visitors per month', none: 'No numbers for this period yet.',
    lists: { pages: 'Pages', sources: 'Where they came from', tags: 'Link tags (?src=)', devices: 'Devices', countries: 'Countries', videos: 'Videos', events: 'Events', missing: 'Missing pages (404)' },
    direct: 'Direct (typed, bookmark or an app)', device: { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' },
    watched: 'watched on average', tagsEmpty: 'Add ?src=name to a link (for example ?src=facebook) to see here how many people came through it.',
    help: 'One person is one visitor per day. Single visits are deleted after KEEP_DAYS days; daily totals stay. To keep your own visits out, open any page of your site once with ?notrack=1 (undo: ?notrack=0).',
    event: { phone: 'Phone click', email: 'E-mail click', form_start: 'Form started', form_submit: 'Form sent', form_sent: 'Form sent' },
    visitorsWord: ['visitor', 'visitors'], locale: 'en-GB'
  };
  document.documentElement.lang = et ? 'et' : 'en';
  document.title = T.title;
  $('#title').textContent = T.title;
  $('#tokenLabel').textContent = T.key;
  $('#open').textContent = T.open;
  $('#forget').textContent = T.forget;
  $('#help').textContent = T.help;
  document.querySelectorAll('#range button').forEach(function (b) { b.textContent = T.days[b.dataset.days]; });

  var KEY = 'visit-counter:token';
  var days = 30;
  var token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) { /* asked every time */ }

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nf = function (n) { return Math.round(n || 0).toLocaleString(T.locale); };
  var secs = function (s) { s = Math.round(s || 0); if (s < 60) return s + ' s'; var m = Math.floor(s / 60), r = s % 60; return m + ' min' + (r ? ' ' + r + ' s' : ''); };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; };
  var regions = null;
  try { regions = new Intl.DisplayNames([et ? 'et' : 'en'], { type: 'region' }); } catch (e) { /* codes */ }
  var country = function (c) { try { return (regions && regions.of(c)) || c; } catch (e) { return c; } };
  var SOURCES = [
    [/^$/, T.direct], [/(^|\.)gemini\.google\./, 'Gemini'], [/(^|\.)google\./, 'Google'], [/^com\.google\.android\.gm$/, 'Gmail'],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)bing\.com$/, 'Bing'],
    [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT'], [/(^|\.)perplexity\.ai$/, 'Perplexity'],
    [/(^|\.)claude\.ai$/, 'Claude'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube']
  ];
  var source = function (h) { for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i][0].test(h)) return SOURCES[i][1]; return h; };

  function merge(rows, name) {
    var map = {}, out = [];
    rows.forEach(function (r) {
      var k = name(r.v);
      if (!map[k]) { map[k] = { k: k, n: 0, total: 0 }; out.push(map[k]); }
      map[k].n += r.n; map[k].total += r.total || 0;
    });
    return out.sort(function (a, b) { return b.n - a.n; });
  }

  function list(title, rows, extra, empty) {
    var top = rows.slice(0, 12), most = Math.max.apply(null, [1].concat(top.map(function (r) { return r.n; })));
    var body = top.length ? '<ul>' + top.map(function (r) {
      return '<li style="--w:' + Math.max(2, r.n / most * 100).toFixed(1) + '%"><span class="k">' + esc(r.k) + '</span>' +
        (extra ? '<span class="x">' + esc(extra(r)) + '</span>' : '') + '<span class="n">' + nf(r.n) + '</span></li>';
    }).join('') + '</ul>' : '<p class="none">' + esc(empty || T.none) + '</p>';
    return '<section class="card"><h2>' + esc(title) + '</h2>' + body + '</section>';
  }

  function series(perDay) {
    var out = [], today = new Date(), by = {};
    perDay.forEach(function (d) { by[d.day] = d; });
    if (days === 365) {
      for (var m = 11; m >= 0; m--) {
        var d = new Date(today.getFullYear(), today.getMonth() - m, 1);
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var n = perDay.filter(function (x) { return x.day.indexOf(key) === 0; }).reduce(function (s, x) { return s + x.visitors; }, 0);
        var label = d.toLocaleDateString(T.locale, { month: 'short' });
        out.push({ label: label, long: d.toLocaleDateString(T.locale, { month: 'long', year: 'numeric' }), n: n });
      }
      return out;
    }
    for (var i = days - 1; i >= 0; i--) {
      var day = new Date(today.getTime() - i * 86400000);
      var iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
      out.push({
        label: days === 7 ? day.toLocaleDateString(T.locale, { weekday: 'short' }) : day.getDate() + '.' + (day.getMonth() + 1),
        long: day.toLocaleDateString(T.locale, { day: 'numeric', month: 'long' }), n: by[iso] ? by[iso].visitors : 0
      });
    }
    return out;
  }

  function render(d) {
    var per = d.perDay || [], L = d.lists || {};
    var total = function (k) { return per.reduce(function (s, x) { return s + (x[k] || 0); }, 0); };
    var visitors = total('visitors'), views = total('views'), timed = total('timed');
    var ev = (L.events || []).reduce(function (m, r) { var t = r.v.split(':')[0]; m[t] = (m[t] || 0) + r.n; return m; }, {});
    $('#sum').textContent = nf(visitors) + ' ' + T.visitorsWord[visitors === 1 ? 0 : 1] + ' ' + T.period[days];
    $('#kpis').innerHTML = [
      [nf(visitors), T.visitors, T.visitorsSub],
      [nf(views), T.views, visitors ? (views / visitors).toFixed(1) + ' ' + T.perVisitor : ''],
      [secs(timed ? total('seconds') / timed : 0), T.time, T.timeSub],
      [nf((ev.phone || 0) + (ev.email || 0)), T.contacts, ''],
      [nf((ev.form_sent || 0) || (ev.form_submit || 0)), T.forms, '']
    ].map(function (k) { return '<div class="card kpi"><b>' + esc(k[0]) + '</b><span>' + esc(k[1]) + '</span>' + (k[2] ? '<small>' + esc(k[2]) + '</small>' : '') + '</div>'; }).join('');

    var pts = series(per), most = Math.max.apply(null, [1].concat(pts.map(function (p) { return p.n; })));
    $('#chartTitle').textContent = days === 365 ? T.perMonth : T.perDay;
    $('#chart').setAttribute('aria-label', $('#chartTitle').textContent + ': ' + pts.map(function (p) { return p.long + ' ' + p.n; }).join(', '));
    $('#chart').innerHTML = pts.map(function (p) { return '<span class="' + (p.n ? '' : 'zero') + '" title="' + esc(p.long + ': ' + p.n) + '"><i style="--h:' + (p.n / most * 100).toFixed(1) + '%"></i></span>'; }).join('');
    var ticks = days === 30 ? [pts[0], pts[10], pts[20], pts[29]] : pts;
    $('#axis').innerHTML = ticks.map(function (p) { return '<span>' + esc(p.label) + '</span>'; }).join('');

    var same = function (v) { return v; };
    var sources = merge(L.sources || [], source), sSum = sources.reduce(function (s, r) { return s + r.n; }, 0);
    var devices = merge(L.devices || [], function (v) { return T.device[v] || v; }), dSum = devices.reduce(function (s, r) { return s + r.n; }, 0);
    var countries = merge(L.countries || [], country), cSum = countries.reduce(function (s, r) { return s + r.n; }, 0);
    var events = merge(L.events || [], function (v) {
      var i = v.indexOf(':'), t = v.slice(0, i), n = v.slice(i + 1);
      return (T.event[t] || t) + (n ? ': ' + n : '');
    });
    $('#lists').innerHTML = [
      list(T.lists.pages, merge(L.pages || [], same), function (r) { return secs(r.total / Math.max(1, r.n)); }),
      list(T.lists.sources, sources, function (r) { return pct(r.n, sSum); }),
      list(T.lists.tags, merge(L.tags || [], same), null, T.tagsEmpty),
      list(T.lists.devices, devices, function (r) { return pct(r.n, dSum); }),
      list(T.lists.countries, countries, function (r) { return pct(r.n, cSum); }),
      list(T.lists.videos, merge(L.videos || [], same), function (r) { return T.watched + ' ' + Math.round(r.total / Math.max(1, r.n)) + '%'; }),
      list(T.lists.events, events),
      list(T.lists.missing, merge(L.missing || [], same))
    ].join('');
  }

  function showLogin(message) {
    $('#board').hidden = true;
    $('#login').hidden = false;
    $('#err').textContent = message || '';
    $('#token').focus();
  }

  function load() {
    document.querySelectorAll('#range button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)); });
    fetch('data?days=' + days, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) { token = ''; try { localStorage.removeItem(KEY); } catch (e) { /* */ } showLogin(T.wrong); return null; }
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (d) { if (!d) return; $('#login').hidden = true; $('#board').hidden = false; render(d); })
      .catch(function () { $('#sum').textContent = T.failed; });
  }

  $('#login').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('#token').value.trim();
    if (!token) return;
    try { localStorage.setItem(KEY, token); } catch (err) { /* this visit only */ }
    load();
  });
  $('#range').addEventListener('click', function (e) {
    var b = e.target.closest('[data-days]');
    if (!b || Number(b.dataset.days) === days) return;
    days = Number(b.dataset.days);
    load();
  });
  $('#forget').addEventListener('click', function () {
    token = '';
    try { localStorage.removeItem(KEY); } catch (e) { /* */ }
    showLogin('');
  });

  if (token) load(); else showLogin('');
})();
