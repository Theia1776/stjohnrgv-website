/**
 * EXPIRES 2026-11-29 — delete this file on the next cleanup pass.
 *
 * Nothing here can remove itself from the repository, but it does
 * switch itself off: from the 29th boardIsOpen() is permanently true
 * and every check below is a no-op. So leaving it costs nothing but
 * a few lines of dead code. Grep the repo for "EXPIRES 20" to find
 * this and anything else like it.
 *
 * To remove it: delete this file, drop the boardIsOpen import and the
 * gate from src/lib/board-access.ts, and drop boardOpen/boardItem/
 * boardMobile from src/components/Header.astro so the link is
 * unconditional again.
 *
 * ---
 *
 * When the parish board opens to everyone.
 *
 * The board is finished and live, but it's being held back so it can
 * be announced with the December newsletter on 29 November 2026
 * rather than discovered half-empty by whoever happens to click
 * around first. A board nobody is posting in looks dead; a board
 * announced on a Sunday with three rooms ready for people has a
 * chance.
 *
 * Until then: admins get in and can set it up, everyone else is told
 * it isn't open yet. The menu link appears on its own on the 29th —
 * this is checked at the moment somebody loads the page, not when the
 * site was built, so nothing has to be deployed that morning.
 *
 * Midnight on the 29th, parish time. Bayview is US Central, which is
 * UTC-6 in November, so that's 06:00 UTC.
 */
export const BOARD_OPENS_AT = "2026-11-29T06:00:00Z";

/** Is the board open to everyone yet? */
export function boardIsOpen(now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(BOARD_OPENS_AT);
}

/**
 * What somebody is told if they find it early. Deliberately vague
 * about what "it" is — no point spoiling the announcement for a
 * person who guessed a URL.
 */
export const NOT_OPEN_YET =
  "This part of the site isn't open yet. Watch for the December newsletter.";
