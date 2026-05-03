/**
 * Saint database lookup.
 *
 * Loads every saint JSON in src/data/saints/ at build time and exposes
 *   - the array (`saints`)
 *   - a slug → SaintData map (`saintsBySlug`)
 *   - a fuzzy-by-name finder (`findSaint`)
 *
 * `findSaint` is meant for the calendar integration: HTC's calendar
 * surfaces saint names with extra context ("Translation of the relics
 * of … (1230)", "Venerable … (Greek)") while the parish JSON files
 * carry tighter canonical names. We normalize both sides — strip
 * hagiographic prefixes, parens, and punctuation — then check
 * substring containment in either direction.
 */

export interface SaintData {
  name: string;
  slug: string;
  feasts: string[];
  life: string;
  attribution: string;
  troparion: string;
  kontakion: string;
  iconSlug: string;
}

const saintModules = import.meta.glob<{ default: SaintData }>(
  "../data/saints/*.json",
  { eager: true },
);

export const saints: SaintData[] = Object.values(saintModules).map((m) => m.default);

export const saintsBySlug: Map<string, SaintData> = new Map(
  saints.map((s) => [s.slug, s]),
);

/**
 * Strips one optional "the " + one hagiographic title word per pass,
 * iterating until the head settles. Matches the same prefix list the
 * /admin/saints slug-generator uses (stripped of "child-martyr" /
 * "new \w+" multi-word entries since those don't appear at the start
 * of HTC saint lines on the calendar).
 */
const PREFIX_RE =
  /^(?:(?:the\s+)?(?:saint(?:ed)?|holy|venerable|monk|martyr|hieromartyr|righteous|apostle|prophet|blessed)\s+)+/i;

/**
 * Normalize a saint name for matching.
 *   - lowercase
 *   - drop parens / brackets and their contents (dates, language tags)
 *   - peel hagiographic prefixes
 *   - drop any remaining punctuation
 *   - collapse whitespace
 */
export function normalizeName(s: string): string {
  let n = String(s ?? "").toLowerCase();
  n = n.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  n = n.replace(PREFIX_RE, "");
  n = n.replace(/[^a-z0-9\s]+/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Find a local saint whose normalized name appears within the
 * calendar entry (or vice versa). Returns the first match — order is
 * the import.meta.glob filesystem order, which is alphabetical by
 * filename.
 */
export function findSaint(calendarName: string): SaintData | null {
  const target = normalizeName(calendarName);
  if (!target) return null;
  for (const saint of saints) {
    const local = normalizeName(saint.name);
    if (!local) continue;
    if (target.includes(local) || local.includes(target)) {
      return saint;
    }
  }
  return null;
}
