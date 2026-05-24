// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // `site` is required for the sitemap integration so it can emit
  // absolute URLs (e.g. https://stjohnrgv.org/about/) rather than
  // relative paths. Also benefits canonical URL helpers.
  site: 'https://stjohnrgv.org',

  // Per-page rendering: the vast majority of pages stay prerendered
  // (the default), and pages that need request-time data opt in
  // with `export const prerender = false`. Right now only the
  // library reader (/learn/library/[slug]) is dynamic so it can
  // resolve any slug the admin uploads without rebuilding.
  output: 'static',
  adapter: cloudflare({
    // Pages Functions in /functions still handle our REST API; the
    // Astro adapter only owns the routes that opt out of prerender.
    platformProxy: { enabled: true },
  }),

  integrations: [
    sitemap({
      // Exclude pages that are parishioner-private or have no SEO value.
      // robots.txt also disallows these — belt and suspenders.
      filter: (page) =>
        !page.includes('/account') &&
        !page.includes('/directory') &&
        !page.includes('/coffee-hour') &&
        !page.includes('/admin') &&
        !page.includes('/login') &&
        !page.includes('/seasons-preview'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});