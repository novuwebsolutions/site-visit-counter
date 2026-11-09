// Runs the counter against a real SQLite database (Node's built-in node:sqlite) behind a small
// stand-in for Cloudflare D1, so the SQL is tested as it runs. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { record, stats, fold, sourceOf, pathOf, dayOf, allowedOrigins } from '../visit-counter.mjs';

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const reads = (query) => /^\s*(SELECT|WITH)\b/i.test(query);
  const statement = (query, values = []) => ({
    bind: (...next) => statement(query, next),
    first: async () => sql.prepare(query).get(...values) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => (sql.prepare(query).run(...values), {}),
    exec: () => (reads(query) ? { results: sql.prepare(query).all(...values) } : (sql.prepare(query).run(...values), { results: [] })),
  });
  return {
    sql,
    prepare: (query) => statement(query),
    // D1 runs a batch as one transaction.
    batch: async (list) => {
      sql.exec('BEGIN');
      try {
        const out = list.map((s) => s.exec());
        sql.exec('COMMIT');
        return out;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const SITE = 'https://example.com';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DAY = Date.UTC(2026, 10, 9, 10, 0); // 9 November 2026, noon in Tallinn

function note(body, headers = {}) {
  return new Request(`${SITE}/visits/hit`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { origin: SITE, 'user-agent': BROWSER, 'cf-connecting-ip': '198.51.100.7', 'cf-ipcountry': 'EE', ...headers },
  });
}
const env = () => ({ DB: fakeD1(), ALLOWED_ORIGINS: `${SITE},https://www.example.com` });
const rows = (e, q) => e.DB.sql.prepare(q).all();

test('the small helpers', () => {
  assert.equal(sourceOf('https://www.google.com/search?q=x', ['example.com']), 'google.com');
  assert.equal(sourceOf('https://l.facebook.com/', ['example.com']), 'facebook.com');
  assert.equal(sourceOf('https://www.example.com/hind/', ['example.com']), null);
  assert.equal(sourceOf('', ['example.com']), '');
  assert.equal(sourceOf('not a url', ['example.com']), '');
  assert.equal(pathOf('/p%C3%A4ev/?src=fb#top'), '/päev/');
  assert.equal(pathOf('https://evil.example/'), '');
  assert.equal(dayOf(Date.UTC(2026, 10, 8, 22, 30)), '2026-11-09'); // already Monday in Tallinn
  assert.deepEqual(allowedOrigins({}, new URL(SITE)), [SITE]);
});

test('a page view is counted without any IP address', async () => {
  const e = env();
  await record(note({ t: 'v', id: 'aaaaaaaaaaaaaaaa', p: '/hind/', r: 'https://www.google.ee/', s: 'Facebook', d: 'phone' }), e, { now: DAY });
  const [view] = rows(e, 'SELECT * FROM views');
  assert.equal(view.path, '/hind/');
  assert.equal(view.source, 'google.ee');
  assert.equal(view.tag, 'facebook');
  assert.equal(view.device, 'phone');
  assert.equal(view.country, 'EE');
  assert.equal(view.day, '2026-11-09');
  assert.match(view.visitor, /^[0-9a-f]{16}$/);
  const all = JSON.stringify(rows(e, 'SELECT * FROM views'));
  assert.ok(!all.includes('198.51.100.7'), 'the IP address is not stored');
});

test('notes that must not be counted are ignored', async () => {
  const e = env();
  const view = { t: 'v', id: 'bbbbbbbbbbbbbbbb', p: '/' };
  await record(note(view, { origin: 'https://evil.example' }), e, { now: DAY });
  await record(note(view, { dnt: '1' }), e, { now: DAY });
  await record(note(view, { 'sec-gpc': '1' }), e, { now: DAY });
  await record(note(view, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), e, { now: DAY });
  await record(note({ ...view, id: 'short' }), e, { now: DAY });
  await record(note('x'.repeat(5000)), e, { now: DAY });
  await record(note('{not json'), e, { now: DAY });
  const tables = rows(e, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'views'");
  if (tables.length) assert.equal(rows(e, 'SELECT * FROM views').length, 0);
});

test('events and time belong to the visitor who opened the page', async () => {
  const e = env();
  const id = 'cccccccccccccccc';
  await record(note({ t: 'v', id, p: '/kontakt/' }), e, { now: DAY });
  await record(note({ t: 'e', id, e: 'phone', n: '+3725551234' }), e, { now: DAY });
  await record(note({ t: 'e', id, e: 'phone', n: '+3725551234' }), e, { now: DAY }); // counted once
  await record(note({ t: 'e', id, e: 'video', n: 'Intro' }), e, { now: DAY });
  // Someone else (another IP) cannot add to it.
  await record(note({ t: 'e', id, e: 'form_sent', n: 'contact' }, { 'cf-connecting-ip': '203.0.113.9' }), e, { now: DAY });
  await record(note({ t: 'a', id, s: 95, v: [{ n: 'Intro', p: 62 }] }), e, { now: DAY });
  await record(note({ t: 'a', id, s: 20, v: [{ n: 'Intro', p: 30 }] }), e, { now: DAY }); // never goes down
  await record(note({ t: 'a', id, s: 99999 }), e, { now: DAY }); // capped
  assert.deepEqual(rows(e, 'SELECT type, name, value FROM events ORDER BY type').map((r) => ({ ...r })), [
    { type: 'phone', name: '+3725551234', value: 0 },
    { type: 'video', name: 'Intro', value: 62 },
  ]);
  assert.equal(rows(e, 'SELECT seconds FROM views')[0].seconds, 1800);
});

test('the daily key changes and the old one is deleted', async () => {
  const e = env();
  await record(note({ t: 'v', id: 'dddddddddddddddd', p: '/' }), e, { now: DAY });
  await record(note({ t: 'v', id: 'eeeeeeeeeeeeeeee', p: '/' }), e, { now: DAY + 86400000 });
  const views = rows(e, 'SELECT day, visitor FROM views ORDER BY day');
  assert.notEqual(views[0].visitor, views[1].visitor, 'the same person is a new code the next day');
  assert.deepEqual(rows(e, 'SELECT day FROM salts').map((r) => r.day), ['2026-11-10']);
});

test('folding old days keeps every number the same', async () => {
  const e = env();
  const pages = ['/', '/hind/', '/kontakt/'];
  let n = 0;
  for (let back = 0; back < 40; back++) {
    for (let i = 0; i < 3; i++) {
      const id = String(n++).padStart(16, 'v');
      const headers = { 'cf-connecting-ip': `198.51.100.${i}` };
      await record(note({ t: 'v', id, p: pages[(back + i) % 3], r: i ? 'https://google.com/' : '', d: i ? 'phone' : 'computer' }, headers), e, { now: DAY - back * 86400000 });
      await record(note({ t: 'a', id, s: 30 + i }, headers), e, { now: DAY - back * 86400000 });
      if (i === 1) await record(note({ t: 'e', id, e: 'email', n: 'info@example.com' }, headers), e, { now: DAY - back * 86400000 });
    }
  }
  const before = await stats(e, 365, { now: DAY });
  const folded = await fold(e, 30, { now: DAY });
  assert.equal(folded, 9); // 40 days counted, the 9 before 10 October are folded
  assert.equal(rows(e, "SELECT COUNT(*) AS n FROM views WHERE day < '2026-10-10'")[0].n, 0);
  const after = await stats(e, 365, { now: DAY });
  assert.deepEqual(after.perDay.map((r) => ({ ...r })), before.perDay.map((r) => ({ ...r })));
  for (const name of Object.keys(before.lists)) {
    const sorted = (list) => list.map((r) => ({ ...r })).sort((a, b) => a.v.localeCompare(b.v));
    assert.deepEqual(sorted(after.lists[name]), sorted(before.lists[name]), name);
  }
  assert.equal(before.perDay.reduce((s, d) => s + d.views, 0), 120);
});

test('stats before anything was counted', async () => {
  const e = env();
  const result = await stats(e, 30, { now: DAY });
  assert.deepEqual(result.perDay, []);
  assert.equal(await fold(e, 30, { now: DAY }), 0);
});
