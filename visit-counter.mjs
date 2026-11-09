// site-visit-counter: count a website's visits without cookies, on your own
// Cloudflare account. This file is the server side: it takes the short notes
// counter.js sends, reads the numbers back for the dashboard, and every night
// folds old single visits into daily totals.
//
// What is kept, and for how long (the README has a privacy text to copy):
//   views   one row per page opened: day, address, the other site the visitor
//           came from, the link tag (?src=, utm_source, ref), phone / tablet /
//           computer, country, seconds on screen, and whether the page was missing
//   events  what happened on that page: phone and e-mail clicks, a form started
//           or sent, a video and how much of it was watched, or your own events
//   daily   totals per day, made from views and events older than KEEP_DAYS
//   salts   one random key for today, deleted when the next day begins
//
// No IP address is stored. To tell visitors apart within one day, the IP
// address and the browser's name are hashed with the day's key. Once the key is
// gone, a code can no longer be linked to an address, nor to the same person's
// visits on another day. Nothing is stored in the visitor's browser.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS views (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, time INTEGER NOT NULL, visitor TEXT NOT NULL,
    path TEXT NOT NULL, source TEXT, tag TEXT NOT NULL DEFAULT '', device TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS views_day ON views (day)',
  `CREATE TABLE IF NOT EXISTS events (
    view TEXT NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (view, type, name))`,
  'CREATE INDEX IF NOT EXISTS events_day ON events (day)',
  `CREATE TABLE IF NOT EXISTS daily (
    day TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL,
    total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, value))`,
  'CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

const DEVICES = new Set(['phone', 'tablet', 'computer']);
const VIEW_ID = /^[a-z0-9]{16}$/;
const EVENT_TYPE = /^[a-z0-9_]{1,32}$/;
// Search engines, link previews, speed tests and scripts are not visitors.
const BOT =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|python|curl|wget|httpclient|okhttp|java\/|go-http|node-fetch|axios/i;
const MAX_BODY = 4096;
const MAX_SECONDS = 1800; // a tab left open overnight is not half a day of reading
const MAX_EVENTS = 30; // per page view
const MAX_VIDEOS = 10; // per leave note

/** The calendar day in the given time zone, as 2026-11-09. */
export const dayOf = (time, timeZone = 'Europe/Tallinn') =>
  new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(time));

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A string from the note, without control characters, squeezed spaces, cut to max. */
export const clean = (value, max) =>
  (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The other site a visitor came from: '' for none (typed in, a bookmark, an app), null for your own pages. */
export function sourceOf(referrer, ownHosts) {
  const raw = clean(referrer, 500);
  if (!raw) return '';
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host) return '';
  const bare = host.replace(/^www\./, '');
  if (ownHosts.some((own) => own.replace(/^www\./, '') === bare)) return null;
  // m.facebook.com, l.facebook.com and www.google.com are the same sites as without.
  return host.replace(/^(www|m|l|lm|mobile)\./, '').slice(0, 100);
}

/** The page's address as people read it: no query, no fragment, %-escapes decoded. */
export function pathOf(value) {
  let path = clean(value, 300).split(/[?#]/)[0];
  if (!path.startsWith('/')) return '';
  try {
    path = decodeURI(path);
  } catch {
    // Left as it came.
  }
  return path.slice(0, 200);
}

const ready = new WeakSet();
export async function prepare(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready.add(db);
}

// Today's key, kept in memory between requests to the same Worker.
let cachedKey = null;
async function keyFor(db, day) {
  if (cachedKey?.db === db && cachedKey.day === day) return cachedKey.value;
  const read = () => db.prepare('SELECT value FROM salts WHERE day = ?').bind(day).first();
  let row = await read();
  if (!row) {
    const fresh = hex(crypto.getRandomValues(new Uint8Array(32)));
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO salts (day, value) VALUES (?, ?)').bind(day, fresh),
      db.prepare('DELETE FROM salts WHERE day <> ?').bind(day),
    ]);
    // Another Worker may have made the day's key a moment earlier: everyone uses the stored one.
    row = await read();
  }
  cachedKey = { db, day, value: row.value };
  return row.value;
}

export async function visitorCode(db, day, ip, agent) {
  const data = new TextEncoder().encode(`${await keyFor(db, day)}|${ip}|${agent}`);
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
}

/** The origins allowed to send notes: ALLOWED_ORIGINS (comma separated), else the Worker's own. */
export function allowedOrigins(env, url) {
  const list = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length ? list : [url.origin];
}

/**
 * Takes one note from a page. Returns quietly in every case: a note that is not
 * counted gets the same empty answer as one that is, so the page never waits or
 * shows an error, and someone probing the address learns nothing.
 */
export async function record(request, env, options = {}) {
  const db = env.DB;
  if (!db || request.method !== 'POST') return;
  const url = new URL(request.url);
  const origins = allowedOrigins(env, url);
  // Browsers always say where a POST comes from.
  const origin = request.headers.get('origin');
  if (!origin || !origins.includes(origin)) return;
  // The visitor asked not to be followed.
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return;
  const agent = request.headers.get('user-agent') ?? '';
  if (!agent || BOT.test(agent)) return;
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  if (env.HIT_LIMIT) {
    try {
      if (!(await env.HIT_LIMIT.limit({ key: ip })).success) return;
    } catch {
      // A hiccup in the limiter does not cost a visit.
    }
  }

  const body = await request.text();
  if (body.length > MAX_BODY) return;
  let note;
  try {
    note = JSON.parse(body);
  } catch {
    return;
  }
  if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !VIEW_ID.test(note.id)) return;

  await prepare(db);
  const now = options.now ?? Date.now();
  const day = dayOf(now, env.TIME_ZONE || undefined);
  const visitor = await visitorCode(db, day, ip, agent);

  if (note.t === 'v') {
    const path = pathOf(note.p);
    if (!path) return;
    const tag = clean(note.s, 60).toLowerCase();
    const country = String(request.cf?.country ?? request.headers.get('cf-ipcountry') ?? '').toUpperCase();
    const ownHosts = origins.map((o) => {
      try {
        return new URL(o).hostname;
      } catch {
        return '';
      }
    });
    await db
      .prepare('INSERT OR IGNORE INTO views (id, day, time, visitor, path, source, tag, device, country, missing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(
        note.id,
        day,
        now,
        visitor,
        path,
        sourceOf(note.r, ownHosts),
        /^[a-z0-9._-]{1,40}$/.test(tag) ? tag : '',
        DEVICES.has(note.d) ? note.d : 'computer',
        /^[A-Z0-9]{2}$/.test(country) ? country : '',
        note.x === 1 ? 1 : 0,
      )
      .run();
    return;
  }

  // The other notes belong to a view already counted, sent from the same
  // address and browser, so nobody can add clicks to someone else's visit.
  if (note.t === 'e') {
    if (typeof note.e !== 'string' || !EVENT_TYPE.test(note.e)) return;
    await db
      .prepare(
        `INSERT OR IGNORE INTO events (view, day, type, name)
         SELECT id, day, ?, ? FROM views WHERE id = ? AND visitor = ?
         AND (SELECT COUNT(*) FROM events WHERE view = ?) < ${MAX_EVENTS}`,
      )
      .bind(note.e, clean(note.n, 80), note.id, visitor, note.id)
      .run();
    return;
  }

  if (note.t === 'a') {
    const own = await db.prepare('SELECT 1 AS x FROM views WHERE id = ? AND visitor = ?').bind(note.id, visitor).first();
    if (!own) return;
    const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round(Number(note.s) || 0)));
    const statements = [db.prepare('UPDATE views SET seconds = MAX(seconds, ?) WHERE id = ?').bind(seconds, note.id)];
    for (const video of Array.isArray(note.v) ? note.v.slice(0, MAX_VIDEOS) : []) {
      if (!video || typeof video !== 'object') continue;
      const share = Math.min(100, Math.max(0, Math.round(Number(video.p) || 0)));
      statements.push(
        db
          .prepare("UPDATE events SET value = MAX(value, ?) WHERE view = ? AND type = 'video' AND name = ?")
          .bind(share, note.id, clean(video.n, 80)),
      );
    }
    await db.batch(statements);
  }
}

// The dashboard's lists: from single rows (recent days) plus daily totals (older days).
// Each row is a value, a count and a total (seconds on screen, or per cent of a video watched).
const LISTS = {
  pages: ['page', 'SELECT path AS v, COUNT(*) AS n, SUM(seconds) AS total FROM views WHERE day >= ? AND missing = 0 GROUP BY path'],
  sources: ['source', 'SELECT source AS v, COUNT(*) AS n, 0 AS total FROM views WHERE day >= ? AND source IS NOT NULL AND missing = 0 GROUP BY source'],
  tags: ['tag', "SELECT tag AS v, COUNT(*) AS n, 0 AS total FROM views WHERE day >= ? AND tag <> '' AND source IS NOT NULL GROUP BY tag"],
  devices: ['device', 'SELECT device AS v, COUNT(*) AS n, 0 AS total FROM views WHERE day >= ? AND source IS NOT NULL AND missing = 0 GROUP BY device'],
  countries: ['country', "SELECT country AS v, COUNT(*) AS n, 0 AS total FROM views WHERE day >= ? AND source IS NOT NULL AND missing = 0 AND country <> '' GROUP BY country"],
  missing: ['missing', 'SELECT path AS v, COUNT(*) AS n, 0 AS total FROM views WHERE day >= ? AND missing = 1 GROUP BY path'],
  videos: ['e:video', "SELECT name AS v, COUNT(*) AS n, SUM(value) AS total FROM events WHERE day >= ? AND type = 'video' GROUP BY name"],
  events: [null, "SELECT type || ':' || name AS v, COUNT(*) AS n, 0 AS total FROM events WHERE day >= ? AND type <> 'video' GROUP BY type, name"],
};

const noTables = (error) => /no such table/i.test(String(error?.message));

/** The numbers for the last `days` days: per day, and the lists. */
export async function stats(env, days, options = {}) {
  const db = env.DB;
  const now = options.now ?? Date.now();
  const from = dayOf(now - (days - 1) * 86400000, env.TIME_ZONE || undefined);
  const empty = { days, from, perDay: [], lists: {} };
  try {
    const statements = [
      db
        .prepare(
          `SELECT day, SUM(views) AS views, SUM(visitors) AS visitors, SUM(seconds) AS seconds, SUM(timed) AS timed FROM (
            SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, SUM(seconds) AS seconds, SUM(seconds > 0) AS timed
              FROM views WHERE day >= ? AND missing = 0 GROUP BY day
            UNION ALL
            SELECT day,
              SUM(CASE WHEN kind = 'views' THEN count ELSE 0 END), SUM(CASE WHEN kind = 'visitors' THEN count ELSE 0 END),
              SUM(CASE WHEN kind = 'views' THEN total ELSE 0 END), SUM(CASE WHEN kind = 'timed' THEN count ELSE 0 END)
              FROM daily WHERE day >= ? AND kind IN ('views', 'visitors', 'timed') GROUP BY day
          ) GROUP BY day ORDER BY day`,
        )
        .bind(from, from),
    ];
    const names = Object.keys(LISTS);
    for (const name of names) {
      const [kind, recent] = LISTS[name];
      const folded = kind
        ? `SELECT value AS v, count AS n, total FROM daily WHERE day >= ? AND kind = '${kind}'`
        : "SELECT substr(kind, 3) || ':' || value AS v, count AS n, total FROM daily WHERE day >= ? AND kind LIKE 'e:%' AND kind <> 'e:video'";
      statements.push(
        db.prepare(`SELECT v, SUM(n) AS n, SUM(total) AS total FROM (${recent} UNION ALL ${folded}) GROUP BY v ORDER BY n DESC, v LIMIT 50`).bind(from, from),
      );
    }
    const [perDay, ...lists] = await db.batch(statements);
    return { days, from, perDay: perDay.results, lists: Object.fromEntries(names.map((name, i) => [name, lists[i].results])) };
  } catch (error) {
    if (noTables(error)) return empty; // nothing counted yet
    throw error;
  }
}

/**
 * Every day older than keepDays becomes one row per page, source, tag, device,
 * country, missing page and event, and its single rows are deleted in the same
 * transaction, so the totals never count a visit twice or lose one.
 */
export async function fold(env, keepDays = 30, options = {}) {
  const db = env.DB;
  const now = options.now ?? Date.now();
  const limit = dayOf(now - keepDays * 86400000, env.TIME_ZONE || undefined);
  let old;
  try {
    old = (await db.prepare('SELECT DISTINCT day FROM views WHERE day < ? ORDER BY day').bind(limit).all()).results;
  } catch (error) {
    if (noTables(error)) return 0;
    throw error;
  }
  const add = 'INSERT INTO daily (day, kind, value, count, total) ';
  const merge = ' ON CONFLICT (day, kind, value) DO UPDATE SET count = count + excluded.count, total = total + excluded.total';
  const byViews = (where, what, sum = '0') =>
    db.prepare(`${add}SELECT day, ?, ${what}, COUNT(*), ${sum} FROM views WHERE day = ? AND ${where} GROUP BY day, ${what}${merge}`);
  for (const { day } of old) {
    await db.batch([
      db.prepare(`${add}SELECT day, 'views', '', COUNT(*), COALESCE(SUM(seconds), 0) FROM views WHERE day = ? AND missing = 0 GROUP BY day${merge}`).bind(day),
      db.prepare(`${add}SELECT day, 'visitors', '', COUNT(DISTINCT visitor), 0 FROM views WHERE day = ? AND missing = 0 GROUP BY day${merge}`).bind(day),
      db.prepare(`${add}SELECT day, 'timed', '', SUM(seconds > 0), 0 FROM views WHERE day = ? AND missing = 0 GROUP BY day${merge}`).bind(day),
      byViews('missing = 0', 'path', 'COALESCE(SUM(seconds), 0)').bind('page', day),
      byViews('source IS NOT NULL AND missing = 0', 'source').bind('source', day),
      byViews("tag <> '' AND source IS NOT NULL", 'tag').bind('tag', day),
      byViews('source IS NOT NULL AND missing = 0', 'device').bind('device', day),
      byViews("source IS NOT NULL AND missing = 0 AND country <> ''", 'country').bind('country', day),
      byViews('missing = 1', 'path').bind('missing', day),
      db.prepare(`${add}SELECT day, 'e:' || type, name, COUNT(*), COALESCE(SUM(value), 0) FROM events WHERE day = ? GROUP BY day, type, name${merge}`).bind(day),
      db.prepare('DELETE FROM events WHERE day = ?').bind(day),
      db.prepare('DELETE FROM views WHERE day = ?').bind(day),
    ]);
  }
  await db.prepare('DELETE FROM events WHERE day < ?').bind(limit).run();
  return old.length;
}
