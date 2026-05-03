/**
 * Cloudflare Pages Function: POST /api/admin/save-saint
 *
 * Auth + writer endpoint behind /admin/saints. Validates an admin
 * password against an env var, then commits the saint JSON straight
 * to src/data/saints/<slug>.json on the main branch via the GitHub
 * Contents API. Cloudflare Pages picks up the new commit and redeploys
 * automatically — no manual push step.
 *
 * Required env vars (Cloudflare Pages → Settings → Environment Variables):
 *   ADMIN_PASSWORD     — the admin gate. Pick anything; rotate by
 *                        editing the env var.
 *   GITHUB_TOKEN       — fine-grained PAT or classic PAT with
 *                        "Contents: Read and write" on this repo.
 *
 * Optional env vars (sensible defaults baked in):
 *   GITHUB_REPO_OWNER  — defaults to "Theia1776"
 *   GITHUB_REPO_NAME   — defaults to "stjohnrgv-website"
 *   GITHUB_BRANCH      — defaults to "main"
 *
 * Request body (JSON):
 *   {
 *     password: string,
 *     data: {
 *       name, slug, feasts[], life, attribution,
 *       troparion, kontakion, iconSlug
 *     }
 *   }
 *
 * Responses:
 *   200 { ok, action: "add" | "update", commit, url }
 *   400 { error } — bad payload
 *   401 { error } — wrong password
 *   500 { error } — server misconfigured (missing env vars)
 *   502 { error } — upstream GitHub failure
 */

interface Env {
  ADMIN_PASSWORD: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  GITHUB_BRANCH?: string;
}

interface SaintData {
  name: string;
  slug: string;
  feasts: string[];
  life: string;
  attribution: string;
  troparion: string;
  kontakion: string;
  iconSlug: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_FIELDS = [
  "name",
  "slug",
  "feasts",
  "life",
  "attribution",
  "troparion",
  "kontakion",
  "iconSlug",
];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// Constant-time compare so a wrong password can't be guessed via
// response-time differences. Falls back to inequality on length
// mismatch (safe — the timing leak there is just "you guessed the
// wrong length", which is fine for a parish-scale tool).
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Workers btoa() only handles Latin-1, but saint life text routinely
// includes em-dashes and the © glyph. Encode via TextEncoder, then
// pack each byte as a Latin-1 char before btoa.
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildCanonicalJson(data: SaintData): string {
  // Stable field order matching the existing 12 hand-written files.
  const ordered = {
    name: data.name,
    slug: data.slug,
    feasts: data.feasts,
    life: data.life,
    attribution: data.attribution,
    troparion: data.troparion,
    kontakion: data.kontakion,
    iconSlug: data.iconSlug,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export async function onRequestPost(
  context: { request: Request; env: Env },
): Promise<Response> {
  const env = context.env;

  if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN) {
    return jsonResponse(
      { error: "Server not configured. Missing ADMIN_PASSWORD or GITHUB_TOKEN." },
      500,
    );
  }

  let body: { password?: unknown; data?: unknown };
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (typeof body.password !== "string" || !safeCompare(body.password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const data = body.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") {
    return jsonResponse({ error: "Missing data." }, 400);
  }

  for (const k of REQUIRED_FIELDS) {
    if (!(k in data)) {
      return jsonResponse({ error: `Missing field: ${k}` }, 400);
    }
  }
  if (!Array.isArray(data.feasts)) {
    return jsonResponse({ error: "feasts must be an array of strings." }, 400);
  }

  const slug = String(data.slug || "").trim();
  if (!SLUG_RE.test(slug)) {
    return jsonResponse(
      { error: "Invalid slug. Use lowercase letters, digits, and hyphens only." },
      400,
    );
  }

  const canonical: SaintData = {
    name: String(data.name).trim(),
    slug,
    feasts: (data.feasts as unknown[]).map((f) => String(f).trim()).filter(Boolean),
    life: String(data.life).trim(),
    attribution: String(data.attribution).trim(),
    troparion: String(data.troparion).trim(),
    kontakion: String(data.kontakion).trim(),
    iconSlug: String(data.iconSlug).trim(),
  };

  if (!canonical.name) {
    return jsonResponse({ error: "Name is required." }, 400);
  }

  const owner = env.GITHUB_REPO_OWNER || "Theia1776";
  const repo = env.GITHUB_REPO_NAME || "stjohnrgv-website";
  const branch = env.GITHUB_BRANCH || "main";
  const path = `src/data/saints/${slug}.json`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const ghHeaders: Record<string, string> = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "stjohnrgv-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Look up the current SHA of the file on the target branch (needed
  // for an update commit). 404 means the file doesn't exist yet — that's
  // a create, no SHA needed.
  let existingSha: string | undefined;
  try {
    const headRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
    if (headRes.ok) {
      const headData = (await headRes.json()) as { sha?: string };
      existingSha = headData.sha;
    } else if (headRes.status !== 404) {
      const text = await headRes.text();
      return jsonResponse(
        { error: `GitHub head request failed: ${headRes.status} ${text}` },
        502,
      );
    }
  } catch (e) {
    return jsonResponse(
      { error: `Could not reach GitHub: ${(e as Error).message}` },
      502,
    );
  }

  const fileContent = buildCanonicalJson(canonical);
  const action = existingSha ? "Update" : "Add";
  const commitBody: Record<string, unknown> = {
    message: `${action} saint: ${canonical.name}`,
    content: utf8ToBase64(fileContent),
    branch,
  };
  if (existingSha) commitBody.sha = existingSha;

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(commitBody),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    return jsonResponse(
      { error: `GitHub commit failed: ${putRes.status} ${text}` },
      502,
    );
  }

  const putData = (await putRes.json()) as {
    commit?: { sha?: string; html_url?: string };
  };
  return jsonResponse(
    {
      ok: true,
      action: action.toLowerCase(),
      commit: putData.commit?.sha,
      url: putData.commit?.html_url,
    },
    200,
  );
}
