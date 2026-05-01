/**
 * Orthodox (Julian) Pascha dates, expressed in the Gregorian (New Style) calendar.
 *
 * The Orthodox Church computes Pascha by the Julian Paschalion: the first
 * Sunday after the first full moon on or after the vernal equinox (March 21
 * Old Style), and on or after the Jewish Passover. The result is then
 * converted to the civil Gregorian date used here.
 *
 * Each entry maps a calendar year (Gregorian) to that year's Pascha date in
 * ISO 8601 (YYYY-MM-DD), New Style. To recover Old Style, subtract 13 days
 * (valid for the entire 1900–2099 window).
 *
 * These 25 entries were verified against an authoritative published Orthodox
 * calendar source before being added. Do not modify without re-verifying.
 */
export const ORTHODOX_PASCHA: Record<number, string> = {
  2026: "2026-04-12",
  2027: "2027-05-02",
  2028: "2028-04-16",
  2029: "2029-04-08",
  2030: "2030-04-28",
  2031: "2031-04-13",
  2032: "2032-05-02",
  2033: "2033-04-24",
  2034: "2034-04-09",
  2035: "2035-04-29",
  2036: "2036-04-20",
  2037: "2037-04-05",
  2038: "2038-04-25",
  2039: "2039-04-17",
  2040: "2040-05-06",
  2041: "2041-04-21",
  2042: "2042-04-13",
  2043: "2043-05-03",
  2044: "2044-04-24",
  2045: "2045-04-09",
  2046: "2046-04-29",
  2047: "2047-04-21",
  2048: "2048-04-05",
  2049: "2049-04-25",
  2050: "2050-04-17",
};

/**
 * Earliest year covered by the table.
 */
export const PASCHA_YEAR_MIN = 2026;

/**
 * Latest year covered by the table.
 */
export const PASCHA_YEAR_MAX = 2050;
