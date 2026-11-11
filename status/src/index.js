import { COMPONENTS, CSS, applyResults, checkOne, renderPage } from './core.js';

const HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

async function load(env) {
  const [state, hist] = await Promise.all([env.STATUS.get('state', { type: 'json', cacheTtl: 60 }), env.STATUS.get('hist', { type: 'json', cacheTtl: 60 })]);
  return { state, hist };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...HEADERS, allow: 'GET, HEAD' } });
    if (url.pathname === '/status.css') return new Response(CSS, { headers: { ...HEADERS, 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: { ...HEADERS, 'content-type': 'text/plain' } });
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 404, headers: HEADERS });
    if (url.pathname !== '/') return new Response('Not found', { status: 404, headers: { ...HEADERS, 'content-type': 'text/plain' } });
    const { state, hist } = await load(env);
    return new Response(req.method === 'HEAD' ? null : renderPage(state, hist), { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const entries = await Promise.all(COMPONENTS.map(async (c) => [c.id, await checkOne(c)]));
      const prev = await Promise.all([env.STATUS.get('state', 'json'), env.STATUS.get('hist', 'json')]);
      const next = applyResults(prev[0], prev[1], Object.fromEntries(entries));
      await env.STATUS.put('hist', JSON.stringify(next.hist));
      const sig = (x) => JSON.stringify([x?.comps, x?.incidents]);
      // Write state only when something changed, or hourly so "last check" stays honest (keeps KV writes low).
      const stale = !prev[0] || Date.parse(next.state.updated) - Date.parse(prev[0].updated) > 3600000;
      if (stale || sig(next.state) !== sig(prev[0])) await env.STATUS.put('state', JSON.stringify(next.state));
    })());
  },
};
