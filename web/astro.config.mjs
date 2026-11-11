import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const DEFAULT_LASTMOD = '2026-10-09';
/** @type {Record<string, string>} */
const LASTMOD = Object.fromEntries(['/privacy', '/support', '/security', '/subprocessors', '/terms', '/waitlist', '/compare', '/accessibility', '/', '/how-it-works', '/es', '/es/como-funciona', '/es/privacidad', '/es/soporte'].map((p) => [p, '2026-10-11']));

// English/Spanish page pairs: emitted as hreflang alternates in the sitemap (and as <link rel=alternate> by Base.astro).
const PAIRS = [
  { en: '/', es: '/es' },
  { en: '/how-it-works', es: '/es/como-funciona' },
  { en: '/privacy', es: '/es/privacidad' },
  { en: '/support', es: '/es/soporte' },
];

export default defineConfig({
  site: 'https://albena.ai',
  output: 'static',
  outDir: './dist',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // CSP is script-src 'self' https://challenges.cloudflare.com: never inline CSS/JS.
    inlineStylesheets: 'never',
  },
  integrations: [
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith('/admin'),
      // lastmod is the date the page's content last changed materially. Bump it when you edit a page.
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const pair = PAIRS.find((p) => p.en === path || p.es === path);
        const links = pair ? [{ url: `https://albena.ai${pair.en === '/' ? '/' : pair.en}`, lang: 'en' }, { url: `https://albena.ai${pair.es}`, lang: 'es' }] : undefined;
        return { ...item, lastmod: LASTMOD[path] ?? DEFAULT_LASTMOD, ...(links ? { links } : {}) };
      },
    }),
  ],
  vite: {
    build: { assetsInlineLimit: 0 },
  },
});
