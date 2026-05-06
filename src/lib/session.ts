/** Shared session utilities for server-side components and Pages Functions. */
import { createClient, type User } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_COOKIE } from "./supabase";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function verifySession(request: Request): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
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
