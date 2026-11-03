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
      //
      // Anything carrying <meta name="robots" content="noindex"> MUST be
      // excluded here too. Submitting a noindexed URL in a sitemap is a
      // straight contradiction: Search Console reports every one as
      // "Submitted URL marked noindex", and a sitemap full of errors is
      // a sitemap Google learns to trust less. Six were being submitted
      // that way. If you add a noindex to a page, add it to this list.
      filter: (page) =>
        !page.includes('/account') &&
        !page.includes('/directory') &&
        !page.includes('/coffee-hour') &&
        !page.includes('/admin') &&
        !page.includes('/login') &&
        !page.includes('/reset-password') &&
        !page.includes('/seasons-preview') &&
        // noindex by Fr.'s direction — the long historical narrative is
        // reachable by direct link only, so the About page stays about
        // this parish.
        !page.includes('/learn/orthodox-history') &&
        // noindex, and an account-holders' form besides.
        !page.includes('/table/share') &&
        // Templates that need a ?slug= to show anything. Without one
        // they render "no recipe was named", which is a thin page in
        // Google's eyes and a dead end in a visitor's. The real pages
        // they build are not static URLs, so there is nothing here for
        // a sitemap to point at.
        !page.includes('/table/recipe') &&
        !page.includes('/newsletter/issue') &&
        !page.includes('/learn/library/reader') &&
        // A meta-refresh redirect to /login/?register=1 — a short thing
        // to say out loud, not a page to index.
        !page.includes('/register'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});