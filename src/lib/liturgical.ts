/**
 * Liturgical season calculator (Russian / Slavic typikon, Level A)
 *
 * Given any Gregorian date, returns the current liturgical season —
 * the appropriate vestment color, a human-readable label, and short
 * banner copy for the homepage.
 *
 * Scope: this is "Level A" — the major movable seasons (Lent, Holy Week,
 * Pascha, Bright Week, Paschal season, Pentecost, Apostles' Fast,
 * Dormition Fast, Nativity Fast, Christmas season) plus the Twelve Great
 * Feasts that have a fixed Gregorian date. It does NOT model:
 *   - moveable feasts other than the Paschal cycle
 *   - lesser commemorations
 *   - the daily readings cycle (handled separately by orthocal.info)
 *   - same-day rank conflicts (e.g. a Theotokos feast falling in Lent)
 *
 * Anchors: dates marked "NS" are New Style (Gregorian) — what a parishioner
 * sees on a wall calendar in Texas. The Julian/Gregorian offset for the
 * 1900-2099 window is +13 days; fixed feasts are stored as their NS dates
 * directly, so leap-year handling is automatic.
 *
 * The function never throws. On any error (year out of table range, parse
 * failure) it falls back to ORDINARY/GOLD and emits a console.warn.
 */

import { ORTHODOX_PASCHA, PASCHA_YEAR_MIN, PASCHA_YEAR_MAX } from "./pascha-dates.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * One season's full metadata. Returned by getLiturgicalSeason().
 */
export interface LiturgicalSeason {
  /** Stable identifier — use this for equality/lookup. */
  seasonKey: SeasonKey;
  /** Human-readable name, e.g. "Paschal Season". */
  label: string;
  /** CSS variable reference, e.g. "var(--color-liturgical-white)". */
  color: string;
  /** Resolved hex value of the liturgical color, e.g. "#F5F0E8". */
  colorHex: string;
  /** CSS variable reference for text drawn on the liturgical color. */
  textColor: string;
  /** Resolved hex of the text color companion. */
  textColorHex: string;
  /** Human name of the vestment color, e.g. "White". For UI labels. */
  vestmentName: string;
  /** Short prose description for tooltips or schema. */
  description: string;
  /** Headline copy for the homepage banner during this season. */
  bannerHeadline: string;
  /** Subline / second sentence under the headline. May be empty. */
  bannerSubline: string;
}

export type SeasonKey =
  | "pascha-day"
  | "bright-week"
  | "paschal-season"
  | "pentecost"
  | "all-saints-week"
  | "apostles-fast"
  | "transfiguration"
  | "dormition-fast"
  | "dormition"
  | "cross-feast"
  | "theotokos-nativity"
  | "theotokos-presentation"
  | "annunciation"
  | "nativity-fast"
  | "nativity-season"
  | "theophany"
  | "holy-week"
  | "lent-weekday"
  | "lent-weekend"
  | "palm-sunday"
  | "ordinary";

// ============================================================================
// Vestment color palette — single source of truth for hex values
// ============================================================================

const VESTMENT = {
  white: { hex: "#F5F0E8", textHex: "#2C3E50", textVar: "var(--color-text-primary)", name: "White" },
  gold: { hex: "#C9A84C", textHex: "#2C3E50", textVar: "var(--color-text-primary)", name: "Gold" },
  // Paschal red: vivid, festal — used for Pascha day, Bright Week, Paschal season.
  // Distinct from the somber oxblood `red` used for Apostles' Fast / Cross / martyrs.
  paschalRed: { hex: "#E60000", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Paschal Red" },
  red: { hex: "#8B2C2C", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Red" },
  green: { hex: "#5B7A4A", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Green" },
  blue: { hex: "#4A6B8A", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Blue" },
  purple: { hex: "#5B3A5C", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Purple" },
  black: { hex: "#2C2828", textHex: "#FAF7F0", textVar: "var(--color-cream-bg)", name: "Black" },
} as const;

type VestmentKey = keyof typeof VESTMENT;

// CSS-var name lookup — kept parallel to VESTMENT so changes stay in one place.
const VESTMENT_VAR: Record<VestmentKey, string> = {
  white: "var(--color-liturgical-white)",
  gold: "var(--color-liturgical-gold)",
  paschalRed: "var(--color-liturgical-paschal-red)",
  red: "var(--color-liturgical-red)",
  green: "var(--color-liturgical-green)",
  blue: "var(--color-liturgical-blue)",
  purple: "var(--color-liturgical-purple)",
  black: "var(--color-liturgical-black)",
};

// ============================================================================
// Per-season metadata (label, banner copy, description, vestment)
// ============================================================================

interface SeasonTemplate {
  label: string;
  vestment: VestmentKey;
  description: string;
  bannerHeadline: string;
  bannerSubline: string;
}

const SEASONS: Record<SeasonKey, SeasonTemplate> = {
  "pascha-day": {
    label: "Pascha — The Holy Resurrection",
    vestment: "paschalRed",
    description: "The Feast of Feasts. The Resurrection of Our Lord, God and Savior Jesus Christ.",
    bannerHeadline: "Christ is Risen! Indeed He is Risen!",
    bannerSubline: "Today is the day the Lord has made.",
  },
  "bright-week": {
    label: "Bright Week",
    vestment: "paschalRed",
    description: "The first week of Pascha — every day is celebrated as Pascha itself.",
    bannerHeadline: "Christ is Risen! Indeed He is Risen!",
    bannerSubline: "Bright Week — every day is Pascha.",
  },
  "paschal-season": {
    label: "Paschal Season",
    vestment: "paschalRed",
    description: "The forty days from Pascha to Ascension, when the Paschal greeting is exchanged.",
    bannerHeadline: "Christ is Risen! Indeed He is Risen!",
    bannerSubline: "We rejoice in the Paschal season.",
  },
  pentecost: {
    label: "Pentecost — The Holy Trinity",
    vestment: "green",
    description: "The descent of the Holy Spirit upon the Apostles; the birthday of the Church.",
    bannerHeadline: "The descent of the Holy Spirit.",
    bannerSubline: "Come, let us worship the Father, and the Son, and the Holy Spirit.",
  },
  "all-saints-week": {
    label: "After Pentecost",
    vestment: "green",
    description: "The week following Pentecost, leading to the Sunday of All Saints.",
    bannerHeadline: "Honoring all the Saints.",
    bannerSubline: "Through the prayers of all the Saints, have mercy on us.",
  },
  "apostles-fast": {
    label: "Apostles' Fast",
    vestment: "red",
    description: "A movable fast preparing for the feast of the Holy Apostles Peter and Paul on July 12.",
    bannerHeadline: "Apostles' Fast",
    bannerSubline: "Preparing for the feast of Ss. Peter and Paul.",
  },
  transfiguration: {
    label: "Transfiguration of the Lord",
    vestment: "white",
    description: "The Transfiguration of Christ on Mount Tabor before Peter, James, and John.",
    bannerHeadline: "Transfiguration of the Lord",
    bannerSubline: "His face shone like the sun, and His garments became white as light.",
  },
  "dormition-fast": {
    label: "Dormition Fast",
    vestment: "blue",
    description: "A two-week fast (Aug 14–27 NS) preparing for the Dormition of the Theotokos.",
    bannerHeadline: "Dormition Fast",
    bannerSubline: "Honoring the Most Holy Theotokos.",
  },
  dormition: {
    label: "Dormition of the Theotokos",
    vestment: "blue",
    description: "The falling-asleep of the Most Holy Theotokos and her translation to heaven.",
    bannerHeadline: "Dormition of the Most Holy Theotokos",
    bannerSubline: "Most holy Theotokos, save us.",
  },
  "cross-feast": {
    label: "Elevation of the Cross",
    vestment: "red",
    description: "The Universal Exaltation of the Precious and Life-Giving Cross.",
    bannerHeadline: "Elevation of the Cross",
    bannerSubline: "Before Thy Cross we bow down in worship, O Master.",
  },
  "theotokos-nativity": {
    label: "Nativity of the Theotokos",
    vestment: "blue",
    description: "The birth of the Most Holy Theotokos and Ever-Virgin Mary.",
    bannerHeadline: "Nativity of the Most Holy Theotokos",
    bannerSubline: "Thy nativity, O Theotokos, brought joy to all the world.",
  },
  "theotokos-presentation": {
    label: "Entry of the Theotokos",
    vestment: "blue",
    description: "The Entry of the Most Holy Theotokos into the Temple at three years of age.",
    bannerHeadline: "Entry of the Theotokos into the Temple",
    bannerSubline: "Today is the prelude of the good will of God.",
  },
  annunciation: {
    label: "Annunciation of the Theotokos",
    vestment: "blue",
    description: "The announcement to the Theotokos of the Incarnation of the Word.",
    bannerHeadline: "Annunciation of the Most Holy Theotokos",
    bannerSubline: "Today is the beginning of our salvation.",
  },
  "nativity-fast": {
    label: "Nativity Fast",
    vestment: "purple",
    description: "A forty-day fast (Nov 28 – Jan 6 NS) preparing for the Nativity of Christ.",
    bannerHeadline: "Nativity Fast",
    bannerSubline: "Preparing for the coming of Christ.",
  },
  "nativity-season": {
    label: "Nativity to Theophany",
    vestment: "gold",
    description: "The festal period from the Nativity of Christ through the eve of Theophany.",
    bannerHeadline: "Christ is Born! Glorify Him!",
    bannerSubline: "The Word was made flesh and dwelt among us.",
  },
  theophany: {
    label: "Theophany of the Lord",
    vestment: "white",
    description: "The Baptism of Christ in the Jordan and the manifestation of the Holy Trinity.",
    bannerHeadline: "Theophany — The Baptism of the Lord",
    bannerSubline: "When Thou, O Lord, wast baptized in the Jordan.",
  },
  "holy-week": {
    label: "Holy Week",
    vestment: "black",
    description: "The week of Christ's Passion, from Holy Monday through Holy Saturday.",
    bannerHeadline: "Holy Week",
    bannerSubline: "Behold, the Bridegroom comes at midnight.",
  },
  "lent-weekday": {
    label: "Great Lent",
    vestment: "black",
    description: "The weekdays of Great Lent — a season of fasting, prayer, and repentance.",
    bannerHeadline: "Great Lent",
    bannerSubline: "A time of fasting, prayer, and repentance.",
  },
  "lent-weekend": {
    label: "Great Lent — The Lord's Day",
    vestment: "purple",
    description: "Saturdays and Sundays of Great Lent — Divine Liturgy is served.",
    bannerHeadline: "Great Lent — The Lord's Day",
    bannerSubline: "Standing fast in the holy fast.",
  },
  "palm-sunday": {
    label: "Lazarus Saturday & Palm Sunday",
    vestment: "green",
    description: "The Raising of Lazarus and the Lord's entry into Jerusalem.",
    bannerHeadline: "Hosanna in the highest!",
    bannerSubline: "Blessed is He who comes in the name of the Lord.",
  },
  ordinary: {
    label: "Ordinary Time",
    vestment: "gold",
    description: "An ordinary Sunday or weekday outside the great fasts and festal seasons.",
    bannerHeadline: "The peace of Christ be with you.",
    bannerSubline: "",
  },
};

// ============================================================================
// Date helpers
// ============================================================================

/**
 * Strip the time component, leaving a date-only Date at local midnight.
 * Avoids cross-timezone surprises (we don't want seasons changing at UTC midnight).
 */
function toLocalDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Add (or subtract) whole days from a date, returning a new Date.
 */
function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Compare two date-only values without time/timezone fuzz.
 */
function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** True when `a < b` at date-only resolution. */
function before(a: Date, b: Date): boolean {
  return a.getTime() < b.getTime();
}

/** True when `a <= b` at date-only resolution. */
function beforeOrEqual(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

/**
 * Parse a "YYYY-MM-DD" Pascha date into a local-midnight Date.
 */
function parsePaschaIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Build a local-midnight Date from year/month(1-12)/day. */
function md(year: number, month1: number, day: number): Date {
  return new Date(year, month1 - 1, day);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve the liturgical season for a given Gregorian (NS) date.
 *
 * Algorithm:
 *   1. Look up Pascha for `date.getFullYear()` (and the previous year, since
 *      January dates may belong to the prior Pascha cycle's continuation).
 *   2. Compute Pentecost (+49d), Apostles' Fast start (+57d), Holy Week
 *      bounds, Lazarus Saturday / Palm Sunday, Lent bounds.
 *   3. Walk the decision tree, first match wins.
 *
 * Returns ORDINARY/GOLD on any failure (out-of-range year, bad input).
 */
export function getLiturgicalSeason(input: Date): LiturgicalSeason {
  try {
    const date = toLocalDateOnly(input);
    const year = date.getFullYear();

    // ------- Look up Pascha (this year and prior year for January edge cases)
    const paschaIso = ORTHODOX_PASCHA[year];
    if (!paschaIso) {
      console.warn(
        `[liturgical] No Pascha date for ${year} (table covers ${PASCHA_YEAR_MIN}–${PASCHA_YEAR_MAX}). Falling back to ordinary.`,
      );
      return buildSeason("ordinary");
    }
    const pascha = parsePaschaIso(paschaIso);

    // ------- Movable cycle (anchored on Pascha)
    const lentStart = addDays(pascha, -48); // Clean Monday
    const lentEnd = addDays(pascha, -9); // last Friday before Lazarus Saturday
    const lazarusSaturday = addDays(pascha, -8);
    const palmSunday = addDays(pascha, -7);
    const holyWeekStart = addDays(pascha, -6); // Holy Monday
    const holyWeekEnd = addDays(pascha, -1); // Holy Saturday
    const brightWeekEnd = addDays(pascha, 7); // Bright Saturday
    const pentecost = addDays(pascha, 49);
    const apostlesFastStart = addDays(pascha, 57); // Monday after All Saints
    const apostlesFastEnd = md(year, 7, 12); // Ss. Peter & Paul, NS

    // ------- Fixed feasts and fasts (NS dates)
    const annunciation = md(year, 4, 7);
    const transfiguration = md(year, 8, 19);
    const dormitionFastStart = md(year, 8, 14);
    const dormitionFastEnd = md(year, 8, 27);
    const dormition = md(year, 8, 28);
    const theotokosNativity = md(year, 9, 21);
    const crossFeast = md(year, 9, 27);
    const theotokosPresentation = md(year, 12, 4);
    const nativityFastStart = md(year, 11, 28);
    const nativityFastEndCurrentYear = md(year, 12, 31); // wraps to next year
    const nativityFastEndNextYear = md(year, 1, 6); // for January dates
    const nativitySeasonStart = md(year, 1, 7);
    const nativitySeasonEnd = md(year, 1, 18);
    const theophany = md(year, 1, 19);

    // ------- Decision tree (first match wins)

    // Movable Paschal cycle
    if (sameDate(date, pascha)) return buildSeason("pascha-day");
    if (before(pascha, date) && beforeOrEqual(date, brightWeekEnd)) {
      return buildSeason("bright-week");
    }
    if (before(brightWeekEnd, date) && before(date, pentecost)) {
      return buildSeason("paschal-season");
    }
    if (sameDate(date, pentecost)) return buildSeason("pentecost");
    if (before(pentecost, date) && before(date, apostlesFastStart)) {
      return buildSeason("all-saints-week");
    }
    if (beforeOrEqual(apostlesFastStart, date) && beforeOrEqual(date, apostlesFastEnd)) {
      return buildSeason("apostles-fast");
    }

    // Fixed feasts (specific days come before fast windows so they win the match)
    if (sameDate(date, transfiguration)) return buildSeason("transfiguration");
    if (sameDate(date, dormition)) return buildSeason("dormition");
    if (sameDate(date, crossFeast)) return buildSeason("cross-feast");
    if (sameDate(date, theotokosNativity)) return buildSeason("theotokos-nativity");
    if (sameDate(date, theotokosPresentation)) return buildSeason("theotokos-presentation");
    if (sameDate(date, annunciation)) return buildSeason("annunciation");
    if (sameDate(date, theophany)) return buildSeason("theophany");

    // Fixed fasts (windows after individual feasts)
    if (beforeOrEqual(dormitionFastStart, date) && beforeOrEqual(date, dormitionFastEnd)) {
      return buildSeason("dormition-fast");
    }

    // Nativity fast spans the year boundary; check current-year tail OR
    // previous-year tail rolling into January.
    if (
      (beforeOrEqual(nativityFastStart, date) && beforeOrEqual(date, nativityFastEndCurrentYear))
      || beforeOrEqual(date, nativityFastEndNextYear)
    ) {
      // Distinguish nativity-fast from the nativity-season window inside it
      if (beforeOrEqual(nativitySeasonStart, date) && beforeOrEqual(date, nativitySeasonEnd)) {
        return buildSeason("nativity-season");
      }
      return buildSeason("nativity-fast");
    }
    if (beforeOrEqual(nativitySeasonStart, date) && beforeOrEqual(date, nativitySeasonEnd)) {
      return buildSeason("nativity-season");
    }

    // Pre-Pascha: Holy Week → Palm Sunday/Lazarus → Lent
    if (beforeOrEqual(holyWeekStart, date) && beforeOrEqual(date, holyWeekEnd)) {
      return buildSeason("holy-week");
    }
    if (sameDate(date, lazarusSaturday) || sameDate(date, palmSunday)) {
      return buildSeason("palm-sunday");
    }
    if (beforeOrEqual(lentStart, date) && beforeOrEqual(date, lentEnd)) {
      const dow = date.getDay(); // 0 Sun, 6 Sat
      if (dow === 0 || dow === 6) return buildSeason("lent-weekend");
      return buildSeason("lent-weekday");
    }

    return buildSeason("ordinary");
  } catch (err) {
    console.warn("[liturgical] Unexpected error, falling back to ordinary:", err);
    return buildSeason("ordinary");
  }
}

/**
 * Build a LiturgicalSeason record for an explicit season key, bypassing the
 * date-based decision tree. Useful for previews, demos, and tests where you
 * want a specific season's metadata regardless of today's date.
 */
export function getSeasonByKey(key: SeasonKey): LiturgicalSeason {
  return buildSeason(key);
}

// ============================================================================
// Internal — build a full LiturgicalSeason from a key
// ============================================================================

function buildSeason(key: SeasonKey): LiturgicalSeason {
  const tpl = SEASONS[key];
  const v = VESTMENT[tpl.vestment];
  return {
    seasonKey: key,
    label: tpl.label,
    color: VESTMENT_VAR[tpl.vestment],
    colorHex: v.hex,
    textColor: v.textVar,
    textColorHex: v.textHex,
    vestmentName: v.name,
    description: tpl.description,
    bannerHeadline: tpl.bannerHeadline,
    bannerSubline: tpl.bannerSubline,
  };
}
