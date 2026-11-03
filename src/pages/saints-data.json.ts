/**
 * The parish saints catalogue, as one static JSON file.
 *
 * Built to dist/saints-data.json. It exists because /calendar/ used to
 * carry this same data inside the document — 2,389 saints, 5.9 MB of
 * HTML, 1.7 MB over the wire after compression, re-downloaded on every
 * single visit, on a link that sits in the main navigation.
 *
 * As its own file it is fetched once and then cached by the browser
 * and by Cloudflare, the page itself drops to a few kilobytes, and the
 * HTML stops being something a phone has to chew through before it can
 * show a calendar.
 *
 * An Astro endpoint rather than a script that writes into public/, so
 * it is generated from src/data/saints/ on every build and cannot fall
 * out of step with what the rest of the site thinks the saints are.
 *
 * `_norm` and `_normAliases` are pre-computed here rather than in the
 * browser: the lookup compares a calendar's spelling of a name against
 * every saint, and normalising 2,389 names on each modal open is work
 * that only ever produces the same answer.
 */
import { saints, normalizeName } from "../lib/saints-lookup";

export const prerender = true;

export function GET(): Response {
  const payload = saints.map((s) => ({
    ...s,
    _norm: normalizeName(s.name),
    _normAliases: (s.aliases ?? []).map((a) => normalizeName(a)).filter(Boolean),
  }));

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // A year. The filename is stable, so this is deliberately paired
      // with the note in public/_headers: when the catalogue changes,
      // the change goes out with a deploy, and Cloudflare purges its
      // own cache on deploy. A browser holding yesterday's copy of a
      // saints list is not a problem worth a cache-buster for.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
