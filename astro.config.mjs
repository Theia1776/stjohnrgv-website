// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // `site` is required for the sitemap integration so it can emit
  // absolute URLs (e.g. https://stjohnrgv.org/about/) rather than
  // relative paths. Also benefits canonical URL helpers.
  site: 'https://stjohnrgv.org',
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
        !page.includes('/reset-password') &&
        !page.includes('/seasons-preview'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});