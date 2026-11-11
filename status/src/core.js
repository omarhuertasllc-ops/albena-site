// Pure status logic: no network, no KV. Tested in test/core.test.js.
// Public-only by design (ALB-WEB-1): components are named after what a visitor sees and are checked through
// their public pages. No hostnames of internal systems, no versions, no error bodies are ever stored or shown.

export const COMPONENTS = [
  { id: 'site', name: 'Website', url: 'https://albena.ai/' },
  { id: 'portal', name: 'Customer portal', url: 'https://account.albena.ai/login' },
];
export const DAYS = 90;
export const OUTAGE_AFTER_FAILS = 2; // two consecutive failed checks (~10 min) before we call it an outage
const MAX_INCIDENTS = 30;

export const dayKey = (d) => d.toISOString().slice(0, 10);

export function emptyState() { return { comps: {}, incidents: [], updated: null }; }

/** Folds one round of check results ({id: boolean}) into state + history. Returns new objects. */
export function applyResults(state, hist, results, now = new Date()) {
  const st = structuredClone(state ?? emptyState());
  const h = structuredClone(hist ?? { days: {} });
  const iso = now.toISOString();
  const day = (h.days[dayKey(now)] ??= {});
  for (const c of COMPONENTS) {
    const up = results[c.id] === true;
    const cur = (st.comps[c.id] ??= { fails: 0, since: iso });
    const wasOut = cur.fails >= OUTAGE_AFTER_FAILS;
    cur.fails = up ? 0 : cur.fails + 1;
    const isOut = cur.fails >= OUTAGE_AFTER_FAILS;
    if (isOut && !wasOut) {
      st.incidents.unshift({ comp: c.id, start: iso, end: null });
      cur.since = iso;
    } else if (!isOut && wasOut) {
      const open = st.incidents.find((i) => i.comp === c.id && !i.end);
      if (open) open.end = iso;
      cur.since = iso;
    }
    const d = (day[c.id] ??= [0, 0]);
    d[1] += 1;
    if (up) d[0] += 1;
  }
  st.incidents = st.incidents.slice(0, MAX_INCIDENTS);
  st.updated = iso;
  const keep = Object.keys(h.days).sort().slice(-DAYS);
  h.days = Object.fromEntries(keep.map((k) => [k, h.days[k]]));
  return { state: st, hist: h };
}

export const isOut = (state, id) => (state?.comps?.[id]?.fails ?? 0) >= OUTAGE_AFTER_FAILS;

export function overall(state) {
  if (!state?.updated) return { key: 'unknown', text: 'Checking status' };
  const out = COMPONENTS.filter((c) => isOut(state, c.id));
  if (out.length === 0) return { key: 'ok', text: 'All systems operational' };
  if (out.length === COMPONENTS.length) return { key: 'bad', text: 'Major outage' };
  return { key: 'warn', text: 'Partial outage' };
}

/** 90 entries oldest to newest: {date, pct|null}. */
export function series(hist, id, now = new Date()) {
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const k = dayKey(new Date(now.getTime() - i * 86400000));
    const v = hist?.days?.[k]?.[id];
    out.push({ date: k, pct: v && v[1] > 0 ? (v[0] / v[1]) * 100 : null });
  }
  return out;
}

export function uptime(hist, id) {
  let ok = 0, n = 0;
  for (const d of Object.values(hist?.days ?? {})) { const v = d[id]; if (v) { ok += v[0]; n += v[1]; } }
  return n ? (ok / n) * 100 : null;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cls = (pct) => (pct === null ? 'na' : pct >= 99.5 ? 'ok' : pct >= 95 ? 'warn' : 'bad');
const fmtPct = (p) => (p === null ? 'No data yet' : `${(Math.floor(p * 100) / 100).toFixed(2)}% uptime`);
const fmtTime = (iso) => iso.replace('T', ' ').slice(0, 16) + ' UTC';

export function renderPage(state, hist, now = new Date()) {
  const o = overall(state);
  const rows = COMPONENTS.map((c) => {
    const bars = series(hist, c.id, now).map((s) => `<i class="${cls(s.pct)}" title="${s.date}: ${s.pct === null ? 'no data' : s.pct.toFixed(1) + '%'}"></i>`).join('');
    const out = isOut(state, c.id);
    return `<section class="comp"><div class="row"><h2>${esc(c.name)}</h2><span class="pill ${out ? 'bad' : state?.updated ? 'ok' : 'na'}">${out ? 'Outage' : state?.updated ? 'Operational' : 'Checking'}</span></div><div class="bars" role="img" aria-label="${esc(c.name)} daily uptime, last ${DAYS} days">${bars}</div><p class="sub"><span>${DAYS} days ago</span><span>${fmtPct(uptime(hist, c.id))}</span><span>Today</span></p></section>`;
  }).join('');
  const cutoff = now.getTime() - 30 * 86400000;
  const inc = (state?.incidents ?? []).filter((i) => Date.parse(i.start) >= cutoff);
  const incHtml = inc.length
    ? `<ul class="inc">${inc.map((i) => `<li><strong>${esc(COMPONENTS.find((c) => c.id === i.comp)?.name ?? 'Service')}</strong> unavailable from ${fmtTime(i.start)} ${i.end ? 'until ' + fmtTime(i.end) : '(ongoing)'}</li>`).join('')}</ul>`
    : '<p class="none">No incidents in the last 30 days.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Albena status</title><meta name="description" content="Live availability of the Albena website and customer portal."><meta name="color-scheme" content="dark light"><link rel="icon" href="https://albena.ai/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/status.css"></head><body><main><header><a class="back" href="https://albena.ai/">Albena</a><h1>Status</h1></header><div class="banner ${o.key}" role="status"><span class="dot" aria-hidden="true"></span>${esc(o.text)}</div>${rows}<h2 class="h2">Incidents, last 30 days</h2>${incHtml}<footer><p>Checks run every 5 minutes from Cloudflare&rsquo;s network against our public pages only. ${state?.updated ? 'Last check: ' + fmtTime(state.updated) + '.' : ''} Problems? Email <a href="mailto:support@albena.ai">support@albena.ai</a>. See also <a href="https://albena.ai/security">security</a> and <a href="https://albena.ai/subprocessors">subprocessors</a>.</p></footer></main></body></html>`;
}

export const CSS = `:root{--bg:#08090a;--fg:#f0f1f3;--mut:#9aa0aa;--line:#24262b;--panel:#101114;--ok:#3fb27f;--warn:#e0a93b;--bad:#e5534b;--na:#2b2d33}
@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#15161a;--mut:#5a606b;--line:#e2e4e8;--panel:#f6f7f9;--na:#d9dce1}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px 64px}header{display:flex;align-items:baseline;gap:16px;margin-bottom:24px}h1{font-size:28px;margin:0;letter-spacing:-.02em}
.back{color:var(--mut);text-decoration:none}.back:hover{color:var(--fg)}a{color:var(--fg)}
.banner{display:flex;gap:10px;align-items:center;padding:16px 18px;border-radius:12px;border:1px solid var(--line);background:var(--panel);font-weight:600;margin-bottom:24px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--na)}.banner.ok .dot{background:var(--ok)}.banner.warn .dot{background:var(--warn)}.banner.bad .dot{background:var(--bad)}
.comp{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px 18px;margin-bottom:12px}.row{display:flex;justify-content:space-between;align-items:center;gap:12px}
h2{font-size:17px;margin:0}.h2{margin:32px 0 12px}.pill{font-size:13px;padding:2px 10px;border-radius:99px;border:1px solid var(--line)}.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}.pill.na{color:var(--mut)}
.bars{display:flex;gap:2px;height:34px;margin:14px 0 6px}.bars i{flex:1;border-radius:2px;background:var(--na)}.bars i.ok{background:var(--ok)}.bars i.warn{background:var(--warn)}.bars i.bad{background:var(--bad)}
.sub{display:flex;justify-content:space-between;color:var(--mut);font-size:13px;margin:0}.inc{padding-left:20px}.inc li{margin:6px 0}.none,footer{color:var(--mut);font-size:14px}footer{margin-top:40px}`;

export async function checkOne(c, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(c.url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'AlbenaStatus/1 (+https://status.albena.ai)', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    await r.body?.cancel();
    return r.status >= 200 && r.status < 400;
  } catch { return false; }
}
