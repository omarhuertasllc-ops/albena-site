// Post-build SEO lint over web/dist. Usage: node scripts/seo-check.mjs [--report]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const SITE = 'https://albena.ai';
const report = process.argv.includes('--report');
const errors = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === '_astro' || n === 'admin' ? [] : walk(p)) : p.endsWith('.html') ? [p] : [];
  });
}
const attr = (html, re) => (html.match(re) || [])[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pages = walk(DIST).filter((p) => !p.endsWith('/admin.html'));
const sitemap = readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
const ids = new Set();

for (const file of pages) {
  const rel = relative(DIST, file);
  const html = readFileSync(file, 'utf8');
  const is404 = rel === '404.html';
  const path = is404 ? '/404' : rel === 'index.html' ? '/' : '/' + rel.replace(/\.html$/, '');
  const title = attr(html, /<title>([^<]*)<\/title>/);
  const desc = attr(html, /<meta name="description" content="([^"]*)"/);
  if (report) console.log(`${path}\n  T(${title?.length}) ${title}\n  D(${desc?.length}) ${desc}`);
  if (!title || title.length > 60) err(path, `title missing or >60 (${title?.length})`);
  if (!is404 && (!desc || desc.length > 155 || desc.length < 70)) err(path, `description missing or outside 70-155 (${desc?.length})`);
  if (ids.has(title)) err(path, 'duplicate title');
  ids.add(title);
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) err(path, `expected 1 h1, found ${h1}`);
  if (!/<html lang="(en|es)"/.test(html)) err(path, 'missing lang');
  if (is404) continue;
  const canon = attr(html, /<link rel="canonical" href="([^"]*)"/);
  if (canon !== SITE + (path === '/' ? '/' : path)) err(path, `canonical ${canon}`);
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) if (!html.includes(`property="${p}"`)) err(path, `missing ${p}`);
  for (const n of ['twitter:card', 'twitter:image', 'twitter:image:alt']) if (!html.includes(`name="${n}"`)) err(path, `missing ${n}`);
  if (!sitemap.includes(`<loc>${canon}</loc>`)) err(path, 'not in sitemap');
  if (/<img\b(?![^>]*\balt=)/.test(html)) err(path, '<img> without alt');
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      for (const n of j['@graph'] ?? [j]) if (!n['@type']) err(path, 'JSON-LD node without @type');
      if (m[1].includes('<')) err(path, 'raw < in JSON-LD');
    } catch (e) { err(path, `invalid JSON-LD: ${e.message}`); }
  }
  // internal links must resolve to a built page or public file
  for (const m of html.matchAll(/<a [^>]*href="(\/[^"#?]*)/g)) {
    const h = m[1];
    if (h === '/' || h.startsWith('/admin')) continue;
    if (h.length > 1 && h.endsWith('/')) err(path, `trailing-slash link ${h}`);
    if (!existsSync(join(DIST, h + '.html')) && !existsSync(join(DIST, h))) err(path, `broken internal link ${h}`);
  }
}
for (const f of ['robots.txt', 'llms.txt', 'llms-full.txt', 'og.png', 'sitemap-index.xml']) if (!existsSync(join(DIST, f))) errors.push(`missing dist/${f}`);
const robots = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';
if (!robots.includes(`${SITE}/sitemap-index.xml`)) errors.push('robots.txt does not reference sitemap-index.xml');
if (/Disallow:\s*\/\s*$/m.test(robots)) errors.push('robots.txt blocks everything');
for (const u of sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)) if (u[1].length > SITE.length + 1 && u[1].endsWith('/')) errors.push(`sitemap trailing slash ${u[1]}`);
if (!/<lastmod>/.test(sitemap)) errors.push('sitemap has no lastmod');

if (errors.length) { console.error(`SEO check failed (${errors.length}):\n- ` + errors.join('\n- ')); process.exit(1); }
console.log(`SEO check passed for ${pages.length} pages.`);
