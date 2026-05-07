/**
 * Shared session utilities for server-side components and Pages Functions.
 *
 * The session is held in two cookies — `sb-access-token` (short-lived
 * Supabase JWT, accepted by `auth.getUser`) and `sb-refresh-token`
 * (long-lived, redeemable for a fresh pair). Both are written with a
 * 30-day Max-Age (`SESSION_MAX_AGE`); the access token's *internal*
 * expiry (typically 1 hour) is what governs when verifySession falls
 * through to the refresh path.
 *
 * Refresh flow:
 *   1. Read both cookies.
 *   2. Try `auth.getUser(access)`. If it returns a user, we're done —
 *      no Set-Cookie work needed and `refreshedCookies` is empty.
 *   3. If access is missing or expired, try
 *      `auth.refreshSession({ refresh_token })`. Supabase rotates
 *      refresh tokens on every refresh, so the response gives a new
 *      pair we have to write back.
 *   4. If refresh also fails, return `user: null` and clear both
 *      cookies so the browser stops sending the dead pair.
 *
 * Each handler that calls verifySession() is responsible for piping
 * `refreshedCookies` onto its response with `withSessionCookies`. The
 * helper is a no-op when there's nothing to set, so it's safe to call
 * unconditionally.
 */
import { createClient, type User } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SESSION_COOKIE,
  REFRESH_COOKIE,
  SESSION_MAX_AGE,
} from "./supabase";

export interface SessionResult {
  user: User | null;
  /** Set-Cookie header values to attach to the response if the
   *  session was refreshed (or invalidated). Empty when the access
   *  token was already valid. */
  refreshedCookies: string[];
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function buildCookie(name: string, value: string, maxAge: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

/** Build the two Set-Cookie strings for a successful sign-in or refresh. */
export function authCookies(accessToken: string, refreshToken: string): string[] {
  return [
    buildCookie(SESSION_COOKIE, accessToken, SESSION_MAX_AGE),
    buildCookie(REFRESH_COOKIE, refreshToken, SESSION_MAX_AGE),
  ];
}

/** Build Set-Cookie strings that wipe both session cookies. */
export function clearAuthCookies(): string[] {
  return [
    buildCookie(SESSION_COOKIE, "", 0),
    buildCookie(REFRESH_COOKIE, "", 0),
  ];
}

/**
 * Append `Set-Cookie` headers to an existing Response. Returns a new
 * Response (Workers Response is immutable). No-op when `cookies` is
 * empty so callers can wrap unconditionally.
 */
export function withSessionCookies(response: Response, cookies: string[]): Response {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  cookies.forEach((c) => headers.append("Set-Cookie", c));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function verifySession(request: Request): Promise<SessionResult> {
  const accessToken = readCookie(request, SESSION_COOKIE);
  const refreshToken = readCookie(request, REFRESH_COOKIE);

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Path 1 — current access token still valid.
  if (accessToken) {
    const { data, error } = await auth.auth.getUser(accessToken);
    if (!error && data.user) {
      return { user: data.user, refreshedCookies: [] };
    }
  }

  // Path 2 — access expired or absent. Try the refresh token.
  if (!refreshToken) {
    return { user: null, refreshedCookies: [] };
  }

  const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    // Refresh token bad too — clear both cookies so the browser stops
    // sending dead state on every request.
    return { user: null, refreshedCookies: clearAuthCookies() };
  }

  return {
    user: data.user,
    refreshedCookies: authCookies(data.session.access_token, data.session.refresh_token),
  };
}

export function getFirstName(user: User): string {
  const metadata = user.user_metadata as { full_name?: unknown } | null;
  const fullName = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
  if (fullName) {
    return fullName.split(" ")[0];
  }
  if (user.email) {
    return user.email.split("@")[0];
  }
  return "Member";
}
