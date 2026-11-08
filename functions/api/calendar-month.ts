/**
 * Cloudflare Pages Function: GET /api/calendar-month?year=YYYY&month=M
 *
 * One month's fasting marks, for the calendar grid.
 *
 * Holy Trinity's endpoint serves one day at a time — there is no month
 * view; I checked. So a month costs thirty-one upstream requests, and
 * the whole design of this route is about making the parish's visitors
 * not pay for that and HTC not be hammered for it:
 *
 *   - the light payload. Asking without lives/troparia/scripture gives
 *     252 bytes a day instead of 7.4 KB. A month is about 8 KB upstream.
 *   - a concurrency gate, so it's six connections at a time rather
 *     than thirty-one at once.
 *   - the edge cache. A liturgical date never changes — November 2026
 *     will say the same thing in ten years — so a month is cached hard
 *     and HTC sees one burst per month per region, not one per visitor.
 *
 * Returns { year, month, days: [{ day, kind, season, rule }] }.
 * A day that fails upstream comes back as kind "unknown" rather than
 * failing the whole month: a grid missing one mark is worth more than
 * no grid.
 */
import { htcUrl, fetchHtc, parseFasting } from "../../src/lib/htc-fasting.ts";

interface DayMark {
  day: number;
  kind: "fast" | "fish" | "none" | "unknown";
  season: string | null;
  rule: string | null;
}

const CONCURRENCY = 6;
// Thirty days. The data is fixed for all time; this is really just a
// bound on how long a stale entry could outlive a parser fix.
const MAX_AGE = 60 * 60 * 24 * 30;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": status === 200
        ? `public, max-age=${MAX_AGE}`
        : "no-store",
    },
  });
}

/** Run jobs with at most `limit` in flight, keeping input order. */
async function pooled<T>(count: number, limit: number, job: (i: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(count);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      out[i] = await job(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return out;
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const year = parseInt(url.searchParams.get("year") ?? "", 10);
  const month = parseInt(url.searchParams.get("month") ?? "", 10);

  if (
    !Number.isInteger(year) || !Number.isInteger(month) ||
    month < 1 || month > 12 || year < 1900 || year > 2200
  ) {
    return jsonResponse({ error: "Use ?year=YYYY&month=M." }, 400);
  }

  // Serve from the edge when we can. Keyed on the normalized URL so
  // ?month=1 and ?month=01 share an entry.
  const cacheKey = new Request(
    `${url.origin}/api/calendar-month?year=${year}&month=${month}`,
    { method: "GET" },
  );
  // `caches` is a Workers global; guard by typeof so this route can
  // also be exercised outside that runtime.
  const cache = typeof caches !== "undefined"
    ? (caches as unknown as { default?: Cache }).default
    : undefined;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const days = await pooled<DayMark>(daysInMonth, CONCURRENCY, async (i) => {
    const day = i + 1;
    try {
      const html = await fetchHtc(htcUrl(year, month, day, false));
      const f = parseFasting(html);
      return { day, kind: f.kind, season: f.season, rule: f.rule };
    } catch {
      return { day, kind: "unknown", season: null, rule: null };
    }
  });

  const response = jsonResponse({ year, month, days }, 200);
  // Don't cache a month we largely failed to read — it would pin the
  // gaps in place for a month.
  const failed = days.filter((d) => d.kind === "unknown").length;
  if (cache && failed <= 2) {
    context.request && (await cache.put(cacheKey, response.clone()));
  }
  return response;
}
