// site-visit-counter as one Cloudflare Worker. Under BASE_PATH (default /visits) it answers:
//
//   GET  /visits/counter.js   the script for your pages
//   POST /visits/hit          the notes that script sends
//   GET  /visits/             the dashboard (asks for the STATS_TOKEN key)
//   GET  /visits/data?days=30 the numbers, with "Authorization: Bearer <STATS_TOKEN>"
//
// and every night (the cron in wrangler.jsonc) it folds single visits older than KEEP_DAYS
// into daily totals. wrangler.example.jsonc has the settings, the README the steps.
import { record, stats, fold } from './visit-counter.mjs';
import COUNTER_JS from './counter.js';
import DASHBOARD_HTML from './dashboard.html';
import DASHBOARD_JS from './dashboard.js';

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

const send = (body, type, extra = {}, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': type, ...SECURITY, ...extra } });

const json = (data, status = 200) =>
  send(JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }, status);

/** Compares the key in constant time, so its length and letters cannot be guessed from timing. */
async function sameKey(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(a, b) : new Uint8Array(a).every((x, i) => x === new Uint8Array(b)[i]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const base = (env.BASE_PATH || '/visits').replace(/\/+$/, '');
    if (!url.pathname.startsWith(`${base}/`) && url.pathname !== base) return new Response('Not found', { status: 404 });
    const part = url.pathname.slice(base.length);

    if (part === '/hit') {
      try {
        await record(request, env);
      } catch (error) {
        // A lost note is one missing visit; the page must never notice.
        console.error('[visit-counter]', error);
      }
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...SECURITY } });
    }

    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    if (part === '/counter.js') {
      return send(COUNTER_JS, 'text/javascript; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
    }

    if (part === '' || part === '/') {
      if (part === '') return Response.redirect(`${url.origin}${base}/`, 301);
      return send(DASHBOARD_HTML, 'text/html; charset=utf-8', {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
    }
    if (part === '/dashboard.js') return send(DASHBOARD_JS, 'text/javascript; charset=utf-8', { 'Cache-Control': 'no-store' });

    if (part === '/data') {
      if (!env.STATS_TOKEN) return json({ error: 'Set the STATS_TOKEN secret to open the dashboard.' }, 503);
      const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!given || !(await sameKey(given, env.STATS_TOKEN))) return json({ error: 'Wrong key.' }, 401);
      const days = Number(url.searchParams.get('days'));
      return json(await stats(env, [7, 30, 90, 365].includes(days) ? days : 30));
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(fold(env, Number(env.KEEP_DAYS) || 30));
  },
};
