/**
 * Cloudflare Pages middleware — one site, one hostname.
 *
 * The parish was being served from three hostnames at once:
 *
 *   stjohnrgv.org           the real one
 *   www.stjohnrgv.org       served the whole site, no redirect
 *   stjohnrgv.pages.dev     Cloudflare's build domain, fully crawlable
 *
 * Every page carries `<link rel="canonical">` pointing at the apex, and
 * it was not enough: a search for the parish by name returned
 * **stjohnrgv.pages.dev**, not stjohnrgv.org. A canonical tag is a hint.
 * A hostname that answers 200 and says `Allow: /` in its robots.txt is
 * an invitation, and Google took it — then held a stale copy of the old
 * site, with a phone number the parish no longer uses.
 *
 * That is the likeliest single reason the real domain does not come up:
 * whatever standing the site has earned was being credited to a
 * hostname nobody hands out.
 *
 * So: anything arriving at a hostname that is not the apex is sent to
 * the apex, permanently, at the same path. A 301 is the one signal
 * Google treats as an instruction rather than advice, and it also folds
 * whatever the wrong hostname has accumulated back into the right one.
 *
 * Two deliberate exceptions:
 *
 *   A per-deployment preview host (`<hash>.stjohnrgv.pages.dev`) is let
 *   through so a build can still be looked at before it goes live — but
 *   with `X-Robots-Tag: noindex`, so a preview can never become a
 *   competing copy the way the main build domain did.
 *
 *   Anything local (localhost, 127.0.0.1, *.local) passes untouched, or
 *   `wrangler pages dev` would bounce every request to production.
 *
 * Kept deliberately small and wrapped: middleware runs in front of
 * every single request, so a mistake here is the whole site rather than
 * one page. Anything unexpected falls through to serving the page.
 */

const CANONICAL_HOST = "stjohnrgv.org";

/** Hostnames that are plainly local development. */
function isLocal(host: string): boolean {
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]") ||
    host.endsWith(".local")
  );
}

/**
 * A per-deployment preview, e.g. `a1b2c3d4.stjohnrgv.pages.dev` or a
 * branch alias. The bare `stjohnrgv.pages.dev` is NOT one of these —
 * that is the production build domain, and it is the one that got
 * indexed.
 */
function isPreviewHost(host: string): boolean {
  return host.endsWith(".pages.dev") && host !== "stjohnrgv.pages.dev";
}

/**
 * Typed inline rather than as `PagesFunction`, which would need
 * @cloudflare/workers-types; every other function in this tree states
 * its own context shape the same way.
 */
interface MiddlewareContext {
  request: Request;
  next: () => Promise<Response>;
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const host = url.hostname;

    if (host === CANONICAL_HOST || isLocal(host)) {
      return context.next();
    }

    if (isPreviewHost(host)) {
      // Let it render, but never let it be indexed.
      const response = await context.next();
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    // www, the build domain, or anything else pointed here: one
    // permanent redirect to the same path on the real hostname. The
    // path and query are kept so a shared deep link still lands where
    // it was meant to.
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  } catch {
    // Never let this be the reason a page fails to load.
    return context.next();
  }
}
