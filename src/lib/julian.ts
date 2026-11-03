/**
 * Turning an Old Style feast date into the day it actually falls on.
 *
 * The parish keeps the Julian calendar, and the saints catalogue in
 * src/data/saints/ stores feasts the way the sources that compiled it
 * do — Old Style. St. Nicholas is "December 6" there, the Repose of
 * St. John of Kronstadt is "December 20".
 *
 * Those are not the days anyone turns up. Between 1900 and 2100 the
 * Julian calendar runs thirteen days behind the civil one, so those
 * two are December 19 and January 2 on the wall calendar in Texas.
 * Printing the stored number tells a parishioner to come a fortnight
 * early, and in the case of the Repose, tells them the wrong month.
 *
 * This is the same convention the rest of the site already follows and
 * states plainly: src/lib/feasts.ts and src/lib/liturgical.ts store
 * their fixed feasts as New Style for exactly this reason. The saints
 * catalogue could not, because its dates are also the key the calendar
 * and the Saint of the Day look a saint up by — those convert today's
 * date *to* Julian and match on it. So the data stays Old Style and
 * the conversion happens when it is shown.
 *
 * Anything this cannot parse is passed through untouched. A good
 * number of commemorations are movable — "Sunday of the Myrrhbearers",
 * "Thursday of the Ascension" — and they have no number to shift.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The Julian calendar runs this far behind the civil one, 1900–2099. */
const OFFSET_DAYS = 13;

/**
 * A reference year for the arithmetic. Leap on purpose: the catalogue
 * contains Julian February 29 commemorations, and a non-leap reference
 * would silently roll them into March 1 before the offset was even
 * applied.
 */
const REFERENCE_YEAR = 2024;

export interface NewStyleFeast {
  /** e.g. "January 2" — what a wall calendar says. */
  label: string;
  /** 0–11, for sorting and bucketing. -1 when it could not be parsed. */
  month: number;
  /** 1–31. -1 when it could not be parsed. */
  day: number;
  /** False for movable feasts and anything else with no date in it. */
  converted: boolean;
}

/**
 * "December 20" → { label: "January 2", month: 0, day: 2 }.
 *
 * Returns the input untouched, with `converted: false`, for anything
 * without a plain month-and-day in it.
 */
export function toNewStyle(feast: string): NewStyleFeast {
  const text = String(feast ?? "").trim();
  const match = /^([A-Za-z]+)\s+(\d{1,2})$/.exec(text);
  if (!match) return { label: text, month: -1, day: -1, converted: false };

  const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === match[1].toLowerCase());
  const day = Number(match[2]);
  if (monthIndex === -1 || day < 1 || day > 31) {
    return { label: text, month: -1, day: -1, converted: false };
  }

  // UTC throughout: a local-time Date near midnight can land on the
  // day before or after depending on where the reader is sitting.
  const date = new Date(Date.UTC(REFERENCE_YEAR, monthIndex, day));
  // A day that doesn't exist (February 30) rolls over; that is a bad
  // row in the data rather than something to silently reinterpret.
  if (date.getUTCMonth() !== monthIndex) {
    return { label: text, month: -1, day: -1, converted: false };
  }

  date.setUTCDate(date.getUTCDate() + OFFSET_DAYS);
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  return { label: `${MONTHS[m]} ${d}`, month: m, day: d, converted: true };
}

/** Just the label, for the common case of printing one. */
export function newStyleLabel(feast: string): string {
  return toNewStyle(feast).label;
}

/** A list of feasts, each converted, joined for display. */
export function newStyleList(feasts: unknown, separator = " · "): string {
  if (!Array.isArray(feasts)) return "";
  return feasts.map((f) => newStyleLabel(String(f))).join(separator);
}
