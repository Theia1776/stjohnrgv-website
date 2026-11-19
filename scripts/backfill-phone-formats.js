/**
 * One-time backfill: put every phone number already in the database into
 * house format — (956) 434-6874.
 *
 * Ran once, 18 Nov 2026: 14 stored phone values across 10 member records,
 * 13 of them rewritten (8 people). Afterwards every stored value matched
 * the format exactly. The 4 prayer requests on file had no phone-type
 * contact, so nothing there needed touching.
 *
 * Why it's written this way: the numbers live in Supabase behind the
 * service-role key, which stays in Cloudflare's environment and never
 * comes down to a laptop. So instead of talking to the database directly,
 * this goes through the site's own admin endpoint — the same one the Edit
 * Member window uses — with an admin's ordinary signed-in session.
 *
 * To run it again (it's safe to re-run; it only writes rows that differ):
 *   1. Sign in as an admin and open https://stjohnrgv.org/admin/contacts
 *   2. Open the browser console (F12)
 *   3. Paste this whole file and press Enter
 *
 * The digits are never changed — only the punctuation around them. Any
 * value that isn't a plain US ten-digit number is left exactly as it is.
 */
(async () => {
  // The site's own formatter, so this can't drift from what pages display.
  // Export names are minified in the build; `f` is formatPhone. The hash
  // in the filename changes whenever src/lib/phone.ts does — if this 404s,
  // look up the current name in dist/_astro/ and paste it in.
  const mod = await import("/_astro/phone.B8vsF3wr.js");
  const formatPhone = mod.formatPhone || mod.f;

  const FIELDS = ["phone", "emergency_phone", "emergency_phone_2"];

  const res = await fetch("/api/admin/contacts", { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't read the contact list — are you signed in as an admin?");
  const { contacts } = await res.json();

  let looked = 0;
  const written = [];

  for (const c of contacts) {
    const updates = {};
    for (const field of FIELDS) {
      const current = c[field];
      if (!current) continue;
      looked++;
      const tidy = formatPhone(current);
      if (tidy !== current) updates[field] = tidy;
    }
    if (!Object.keys(updates).length) continue;

    const resp = await fetch("/api/admin/update-contact", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, updates }),
    });
    const body = await resp.json().catch(() => null);
    written.push({
      who: `${c.last_name ?? ""}, ${c.first_name ?? ""}`.trim(),
      fields: Object.keys(updates).join(" + "),
      ok: resp.ok,
      error: body?.error ?? null,
    });
  }

  console.table(written);
  console.log(
    `${looked} stored phone values; ${written.length} record(s) rewritten; ` +
      `${written.filter((w) => !w.ok).length} failed.`,
  );
})();
