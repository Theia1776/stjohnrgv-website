/**
 * Supabase client + shared constants.
 *
 * URL and anon key are public-by-design (the anon key is meant to ship in
 * client code; row-level-security is what actually protects data). They're
 * hardcoded here so the client works in both Astro pages and Cloudflare
 * Pages Functions without env-var plumbing.
 *
 * The service-role key is NEVER imported here — it lives in
 * SUPABASE_SERVICE_ROLE_KEY (Cloudflare env) and is read directly by the
 * server-side functions that need it (functions/api/auth/register.ts).
 */

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://untczlsqrwcmqgqvvgmh.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudGN6bHNxcndjbXFncXZ2Z21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDMxMTAsImV4cCI6MjA5MzUxOTExMH0.9lBBmLMrVKxk1-IiS4ZDXtjuIil1UqamjivXWwH85nA";

/**
 * Anon-key client — safe for browser code and for server-side reads that
 * should respect row-level security. We disable session persistence so this
 * module is safe to share between server (no localStorage) and client (we
 * use httpOnly cookies, not Supabase's default localStorage session).
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/** Cookie name for the access token. HttpOnly, Secure, SameSite=Lax. */
export const SESSION_COOKIE = "sb-access-token";
