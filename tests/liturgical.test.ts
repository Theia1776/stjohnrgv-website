/**
 * Test suite for the liturgical season calculator.
 *
 * Run with:    npm test
 * Under the hood: node --test --experimental-strip-types tests/*.test.ts
 *
 * The cases in the first describe() block come straight from the build spec.
 * Subsequent blocks add boundary cases and a sweep across the multi-year
 * Pascha table to catch regressions in the date math.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getLiturgicalSeason } from "../src/lib/liturgical.ts";
import { ORTHODOX_PASCHA } from "../src/lib/pascha-dates.ts";

/** Construct a local-midnight Date from "YYYY-MM-DD". */
function d(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
}

describe("spec test cases (2026 Paschal cycle)", () => {
  it("2026-04-12 → pascha-day, red", () => {
    const s = getLiturgicalSeason(d("2026-04-12"));
    assert.equal(s.seasonKey, "pascha-day");
    assert.equal(s.vestmentName, "Red");
  });

  it("2026-04-15 → bright-week, white", () => {
    const s = getLiturgicalSeason(d("2026-04-15"));
    assert.equal(s.seasonKey, "bright-week");
    assert.equal(s.vestmentName, "White");
  });

  it("2026-05-01 → paschal-season, white  (today)", () => {
    const s = getLiturgicalSeason(d("2026-05-01"));
    assert.equal(s.seasonKey, "paschal-season");
    assert.equal(s.vestmentName, "White");
  });

  it("2026-05-31 → pentecost, green", () => {
    const s = getLiturgicalSeason(d("2026-05-31"));
    assert.equal(s.seasonKey, "pentecost");
    assert.equal(s.vestmentName, "Green");
  });

  it("2026-07-15 → outside Apostles' Fast (after Ss. Peter & Paul) → ordinary, gold", () => {
    // Spec listed this as apostles-fast/red, but Ss. Peter & Paul is Jul 12 NS,
    // so by Jul 15 the fast has ended. Verify the spec's intent matches the
    // calendar: Pascha 2026 = Apr 12, +57 days = Jun 8 (fast start), Jul 12 (end).
    // Anything after July 12 is back to ordinary time.
    const s = getLiturgicalSeason(d("2026-07-15"));
    assert.equal(s.seasonKey, "ordinary");
  });

  it("2026-08-19 → transfiguration, white", () => {
    const s = getLiturgicalSeason(d("2026-08-19"));
    assert.equal(s.seasonKey, "transfiguration");
    assert.equal(s.vestmentName, "White");
  });

  it("2026-12-25 (civil Christmas Eve+1) → nativity-fast, purple", () => {
    const s = getLiturgicalSeason(d("2026-12-25"));
    assert.equal(s.seasonKey, "nativity-fast");
    assert.equal(s.vestmentName, "Purple");
  });

  it("2027-01-07 → nativity-season, gold", () => {
    const s = getLiturgicalSeason(d("2027-01-07"));
    assert.equal(s.seasonKey, "nativity-season");
    assert.equal(s.vestmentName, "Gold");
  });
});

describe("Pascha 2027 day-of-week derived cases", () => {
  // Pascha 2027 = May 2 (Sunday). Lent thus begins Mar 15 (Clean Monday).
  // 2027-04-19 is a Monday → lent-weekday/black.
  // 2027-04-18 is a Sunday → lent-weekend/purple.
  it("2027-04-19 (Monday in Lent) → lent-weekday, black", () => {
    const s = getLiturgicalSeason(d("2027-04-19"));
    assert.equal(s.seasonKey, "lent-weekday");
    assert.equal(s.vestmentName, "Black");
  });

  it("2027-04-18 (Sunday in Lent) → lent-weekend, purple", () => {
    const s = getLiturgicalSeason(d("2027-04-18"));
    assert.equal(s.seasonKey, "lent-weekend");
    assert.equal(s.vestmentName, "Purple");
  });
});

describe("Paschal cycle boundary days", () => {
  // Pascha 2026 = April 12 → Bright Week ends April 19 → Pentecost = May 31.
  it("Bright Saturday (Pascha + 7) is still Bright Week", () => {
    const s = getLiturgicalSeason(d("2026-04-19"));
    assert.equal(s.seasonKey, "bright-week");
  });

  it("Pascha + 8 days → paschal-season (post-Bright)", () => {
    const s = getLiturgicalSeason(d("2026-04-20"));
    assert.equal(s.seasonKey, "paschal-season");
  });

  it("Day before Pentecost is still paschal-season", () => {
    const s = getLiturgicalSeason(d("2026-05-30"));
    assert.equal(s.seasonKey, "paschal-season");
  });

  it("Day after Pentecost is all-saints-week", () => {
    const s = getLiturgicalSeason(d("2026-06-01"));
    assert.equal(s.seasonKey, "all-saints-week");
  });

  it("Apostles' Fast start (Pentecost + 8 days)", () => {
    // 2026-05-31 + 8 = 2026-06-08
    const s = getLiturgicalSeason(d("2026-06-08"));
    assert.equal(s.seasonKey, "apostles-fast");
  });

  it("Ss. Peter & Paul (Jul 12 NS) → still apostles-fast (last day)", () => {
    const s = getLiturgicalSeason(d("2026-07-12"));
    assert.equal(s.seasonKey, "apostles-fast");
  });

  it("Day before Pascha (Holy Saturday) → holy-week", () => {
    const s = getLiturgicalSeason(d("2026-04-11"));
    assert.equal(s.seasonKey, "holy-week");
  });

  it("Palm Sunday (Pascha − 7) → palm-sunday", () => {
    const s = getLiturgicalSeason(d("2026-04-05"));
    assert.equal(s.seasonKey, "palm-sunday");
  });

  it("Lazarus Saturday (Pascha − 8) → palm-sunday", () => {
    const s = getLiturgicalSeason(d("2026-04-04"));
    assert.equal(s.seasonKey, "palm-sunday");
  });

  it("Last weekday of Lent (Friday before Lazarus) → lent-weekday", () => {
    // 2026-04-03 = Friday, two days before Pascha − 8 (Lazarus Sat 2026-04-04).
    const s = getLiturgicalSeason(d("2026-04-03"));
    assert.equal(s.seasonKey, "lent-weekday");
  });

  it("Clean Monday 2026 (Pascha − 48) → lent-weekday", () => {
    // 2026-04-12 - 48 = 2026-02-23
    const s = getLiturgicalSeason(d("2026-02-23"));
    assert.equal(s.seasonKey, "lent-weekday");
  });
});

describe("Fixed feasts and fasts", () => {
  it("Annunciation (Apr 7 NS)", () => {
    const s = getLiturgicalSeason(d("2026-04-07"));
    assert.equal(s.seasonKey, "annunciation");
    assert.equal(s.vestmentName, "Blue");
  });

  it("Dormition Fast start (Aug 14 NS)", () => {
    const s = getLiturgicalSeason(d("2026-08-14"));
    assert.equal(s.seasonKey, "dormition-fast");
  });

  it("Transfiguration (Aug 19 NS) wins over Dormition Fast", () => {
    const s = getLiturgicalSeason(d("2026-08-19"));
    assert.equal(s.seasonKey, "transfiguration");
  });

  it("Dormition (Aug 28 NS)", () => {
    const s = getLiturgicalSeason(d("2026-08-28"));
    assert.equal(s.seasonKey, "dormition");
  });

  it("Theotokos Nativity (Sep 21 NS)", () => {
    const s = getLiturgicalSeason(d("2026-09-21"));
    assert.equal(s.seasonKey, "theotokos-nativity");
  });

  it("Cross feast (Sep 27 NS)", () => {
    const s = getLiturgicalSeason(d("2026-09-27"));
    assert.equal(s.seasonKey, "cross-feast");
  });

  it("Theotokos Presentation (Dec 4 NS) wins over Nativity Fast", () => {
    const s = getLiturgicalSeason(d("2026-12-04"));
    assert.equal(s.seasonKey, "theotokos-presentation");
  });

  it("Nativity Fast start (Nov 28 NS)", () => {
    const s = getLiturgicalSeason(d("2026-11-28"));
    assert.equal(s.seasonKey, "nativity-fast");
  });

  it("Theophany (Jan 19 NS)", () => {
    // For January, year 2027 — looks back to ORTHODOX_PASCHA[2027].
    const s = getLiturgicalSeason(d("2027-01-19"));
    assert.equal(s.seasonKey, "theophany");
    assert.equal(s.vestmentName, "White");
  });

  it("January 6 NS (eve of Theophany OS Christmas) → still inside nativity season window", () => {
    const s = getLiturgicalSeason(d("2027-01-06"));
    // Jan 6 NS falls in the Nativity Fast roll-over window OR nativity season
    // depending on logic order. Per spec: nativity-season runs Jan 7 - Jan 18,
    // so Jan 6 is the last day of nativity-fast carrying over.
    assert.equal(s.seasonKey, "nativity-fast");
  });
});

describe("Mid-Pentecost sanity check (Pascha + 24)", () => {
  // Mid-Pentecost is Wednesday of the 4th week of Pascha = Pascha + 24 days.
  // Spec specifically asked us to spot-check this — it's often miscalculated.
  // It's not its own season-key in this Level A model (it falls inside
  // paschal-season), but the date arithmetic must be sound: Pascha + 24
  // should land on a Wednesday.
  it("Pascha 2026 + 24 days = Wednesday May 6 → still paschal-season", () => {
    const pascha = d("2026-04-12");
    const midPentecost = new Date(pascha);
    midPentecost.setDate(midPentecost.getDate() + 24);
    assert.equal(midPentecost.getFullYear(), 2026);
    assert.equal(midPentecost.getMonth(), 4); // May
    assert.equal(midPentecost.getDate(), 6);
    assert.equal(midPentecost.getDay(), 3); // Wednesday
    const s = getLiturgicalSeason(midPentecost);
    assert.equal(s.seasonKey, "paschal-season");
  });

  it("Pascha 2027 + 24 days = Wednesday May 26 → still paschal-season", () => {
    const pascha = d("2027-05-02");
    const midPentecost = new Date(pascha);
    midPentecost.setDate(midPentecost.getDate() + 24);
    assert.equal(midPentecost.getDay(), 3); // Wednesday
    const s = getLiturgicalSeason(midPentecost);
    assert.equal(s.seasonKey, "paschal-season");
  });
});

describe("Rank conflicts (fixed feast vs moveable season)", () => {
  // Per the spec's decision tree, fixed feasts (Annunciation, Theophany,
  // Transfiguration, etc.) are checked BEFORE Holy Week / Lent / Palm Sunday.
  // That means a fixed feast falling inside Holy Week wins the slot.
  //
  // 2029: Pascha = April 8 → April 7 (Holy Saturday) is also Annunciation.
  // Per typikon, Annunciation wins (the day is celebrated as Annunciation,
  // with Holy Week services combined).
  it("2029: Annunciation on Holy Saturday → annunciation wins", () => {
    const s = getLiturgicalSeason(d("2029-04-07"));
    assert.equal(s.seasonKey, "annunciation");
    assert.equal(s.vestmentName, "Blue");
  });

  // 2034: Pascha = April 9 → April 7 falls on Holy Friday → annunciation wins.
  it("2034: Annunciation on Holy Friday → annunciation wins", () => {
    const s = getLiturgicalSeason(d("2034-04-07"));
    assert.equal(s.seasonKey, "annunciation");
  });
});

describe("Multi-year smoke test", () => {
  // Walk every year in the table. Two invariants:
  //   1. The exact table date is always pascha-day (nothing wins over Pascha).
  //   2. The day before Pascha is holy-week, EXCEPT when a fixed feast falls
  //      on that day (handled in "Rank conflicts" above). Years where
  //      Pascha − 1 == April 7 (Annunciation): {2029}.
  const ANNUNCIATION_OVERLAP_YEARS = new Set([2029]);

  for (const [yearStr, paschaIso] of Object.entries(ORTHODOX_PASCHA)) {
    const year = Number(yearStr);
    it(`${yearStr}: Pascha ${paschaIso} → pascha-day`, () => {
      const sP = getLiturgicalSeason(d(paschaIso));
      assert.equal(sP.seasonKey, "pascha-day", `Pascha ${year} (${paschaIso}) should be pascha-day`);
    });

    if (!ANNUNCIATION_OVERLAP_YEARS.has(year)) {
      it(`${yearStr}: day before Pascha → holy-week`, () => {
        const pascha = d(paschaIso);
        const dayBefore = new Date(pascha);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const sH = getLiturgicalSeason(dayBefore);
        assert.equal(sH.seasonKey, "holy-week", `Day before Pascha ${year} should be holy-week`);
      });
    }
  }
});

describe("Robustness", () => {
  it("Year outside the table → ordinary, gold + warning (does not throw)", () => {
    const s = getLiturgicalSeason(d("2099-06-15"));
    assert.equal(s.seasonKey, "ordinary");
    assert.equal(s.vestmentName, "Gold");
  });
});
