# Major Build: Liturgical Color System + Coastal Light Palette

This is a significant change. Read the entire prompt before starting, plan your approach, and ask if anything is unclear before writing code.

---

## What we're replacing

The current Tailwind v4 `@theme` palette (gold/burgundy/parchment/near-black) is being replaced. The site is changing from a heavy Byzantine-Slavic aesthetic to a coastal Greek Orthodox one, suitable for a parish in Bayview, Texas (Gulf coast, tropical, bright sunlight).

## Two things are being introduced together

**1. A new year-round base palette** (Coastal Light)  
**2. A liturgical accent color system** that automatically shifts with the Orthodox liturgical calendar (Russian/Slavic typikon)

These work together — the base palette is the constant identity of the site; the liturgical accent shifts to reflect the current liturgical season, the way vestments do in church.

---

## Part 1 — The Coastal Light base palette (replaces existing tokens)

```
--cream-bg:        #FAF7F0   (page background; warm off-white, NOT cool/blue-tinted)
--cream-card:      #FFFFFF   (card surfaces; pure white for contrast against cream bg)
--text-primary:    #2C3E50   (body text; deep slate, never pure black)
--text-secondary:  #5C6B7A   (captions, meta text)
--brand-blue:      #3B7BA8   (Mediterranean blue; primary accent, used always)
--brand-blue-dark: #2A5E84   (hover state for blue elements)
--brand-blue-pale: #E8F1F8   (subtle hover backgrounds, dividers)
--brand-tan:       #C9A87A   (sandstone; secondary accent, used always)
--brand-tan-dark:  #A88758   (hover for tan elements)
--sacred-gold:     #C9A84C   (RESERVED — only for sacred elements: icon borders, the Christ-is-Risen Paschal banner. Never for general UI.)
--border-soft:     #E5DFD3   (subtle borders, dividers when no other color applies)
```

Update `src/styles/global.css` (or wherever the @theme block lives) with these tokens. Replace the existing palette entirely. The Tailwind class names should be: `bg-cream-bg`, `text-text-primary`, `text-brand-blue`, `border-border-soft`, etc. Keep names predictable.

---

## Part 2 — The liturgical color system

### Architecture

Create a new module: `src/lib/liturgical.ts` (or `.js` if the project isn't using TypeScript — match the existing project style).

This module exports a function `getLiturgicalSeason(date: Date)` that returns:

```typescript
{
  seasonKey: string,        // e.g. "paschal", "pentecost-to-apostles", "lent-weekday"
  label: string,             // human-readable e.g. "Paschal Season", "Great Lent"
  color: string,             // CSS variable name, e.g. "var(--liturgical-white)"
  colorHex: string,          // resolved hex, e.g. "#F5F0E8"
  textColor: string,         // for text ON this color (white or dark)
  description: string        // 1-sentence description for tooltips/banners
}
```

### Pascha date table (hardcoded)

Create `src/lib/pascha-dates.ts`:

```typescript
// Orthodox (Julian) Pascha dates, expressed in Gregorian calendar (NS)
// Verified against published Orthodox calendars
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
  2050: "2050-04-17"
};
```

(These are the published Orthodox Pascha dates. Verify these against an authoritative source before committing — if any look wrong, flag for me.)

### Liturgical color tokens

Add these to the global CSS, in the same place as the base palette:

```
--liturgical-white:   #F5F0E8   (Paschal season, Theophany, Transfiguration, funerals)
--liturgical-gold:    #C9A84C   (Christmas season, ordinary Sundays, default)
--liturgical-red:     #8B2C2C   (Pascha [Moscow], Cross feasts, martyrs, Apostles' Fast)
--liturgical-green:   #5B7A4A   (Pentecost to Apostles' Fast, Palm Sunday, monastic saints)
--liturgical-blue:    #4A6B8A   (Theotokos feasts, Annunciation, Dormition)
--liturgical-purple:  #5B3A5C   (Great Lent weekends)
--liturgical-black:   #2C2828   (Great Lent weekdays, Holy Week)
--liturgical-orange:  #A85F2C   (some Ukrainian usage, Apostles' Fast variant)
```

Each gets a corresponding `--liturgical-{color}-text` for whether text on that background should be light or dark. Most use `var(--cream-bg)` as text color; the lighter ones (white, gold) use `var(--text-primary)`.

### The seasonal logic (Russian/Slavic typikon, Level A — major seasons + key feast overrides)

Implement in `getLiturgicalSeason()`:

**Calculation order:**
1. Get the year from `date`
2. Look up Pascha for that year
3. Calculate Pentecost = Pascha + 49 days
4. Calculate Apostles' Fast start = Monday after All Saints (Sunday after Pentecost) = Pentecost + 8 days
5. Calculate Ss. Peter & Paul feast = June 29 OS / **July 12 NS** (Julian-to-Gregorian shift = +13 days for 1900-2099)
6. Calculate Great Lent start (Clean Monday) = Pascha − 48 days
7. Calculate Lazarus Saturday = Pascha − 8 days; Palm Sunday = Pascha − 7 days
8. Calculate Holy Week = Pascha − 6 days through Pascha − 1 day

**Decision tree (apply in order; first match wins):**

```
IF date == Pascha:
  → "pascha-day", "Pascha — The Holy Resurrection", BRIGHT RED (Moscow tradition)

ELIF Pascha < date <= Pascha + 7 days (Bright Week):
  → "bright-week", "Bright Week", WHITE

ELIF Pascha + 7 < date < Pentecost:
  → "paschal-season", "Paschal Season", WHITE

ELIF date == Pentecost:
  → "pentecost", "Pentecost — The Holy Trinity", GREEN

ELIF Pentecost < date < Apostles' Fast start:
  → "all-saints-week", "After Pentecost", GREEN

ELIF Apostles' Fast start <= date <= Ss. Peter & Paul (July 12 NS):
  → "apostles-fast", "Apostles' Fast", RED

ELIF date == Transfiguration (Aug 19 NS):
  → "transfiguration", "Transfiguration of the Lord", WHITE

ELIF Dormition Fast (Aug 14-27 NS):
  → "dormition-fast", "Dormition Fast", BLUE (per Carpatho-Russian)

ELIF date == Dormition (Aug 28 NS):
  → "dormition", "Dormition of the Theotokos", BLUE

ELIF date == Elevation of the Cross (Sep 27 NS):
  → "cross-feast", "Elevation of the Cross", RED

ELIF date == Nativity of the Theotokos (Sep 21 NS):
  → "theotokos-nativity", "Nativity of the Theotokos", BLUE

ELIF date == Presentation of the Theotokos (Dec 4 NS):
  → "theotokos-presentation", "Entry of the Theotokos", BLUE

ELIF date == Annunciation (April 7 NS):
  → "annunciation", "Annunciation of the Theotokos", BLUE

ELIF Nativity Fast (Nov 28 NS - Jan 6 NS):
  → "nativity-fast", "Nativity Fast", PURPLE
  (Carpatho-Russian also accepts red here; using purple as default)

ELIF Christmas season (Jan 7 NS - Jan 18 NS, Nativity through Theophany):
  → "nativity-season", "Nativity to Theophany", GOLD

ELIF date == Theophany (Jan 19 NS):
  → "theophany", "Theophany of the Lord", WHITE

ELIF Holy Week (Pascha − 6 to Pascha − 1):
  IF date == Holy Thursday: GREEN initially, then BLACK after Liturgy (we'll display BLACK for the day)
  ELIF date == Holy Saturday: BLACK (changes to white at Vesperal Liturgy, but display BLACK for the day)
  ELSE: BLACK
  → "holy-week", "Holy Week"

ELIF Great Lent weekdays (Clean Monday through Friday before Lazarus, weekdays only):
  → "lent-weekday", "Great Lent", BLACK

ELIF Great Lent weekends (Saturdays and Sundays during Lent):
  → "lent-weekend", "Great Lent — Sunday", PURPLE

ELIF date == Lazarus Saturday OR Palm Sunday:
  → "palm-sunday", "Lazarus Saturday & Palm Sunday", GREEN

ELSE (ordinary Sundays/weekdays, post-Pentecost through Nativity Fast):
  → "ordinary", "Ordinary Time", GOLD (default Sunday vestment color)
```

### Implementation notes

- Use the user's local time for `date` calculations, but resolve to date-only (no time component) — we don't want seasons changing at midnight UTC.
- All "feast date" comparisons should be on the Gregorian (New Style) date, since that's what the user's calendar shows. Internally, the math anchors off Pascha (which we have in NS).
- For **leap year handling on fixed feast dates** — these are NS dates so leap years don't change them. Just use the NS date directly.
- For testing: write a small `liturgical.test.ts` file (or `.js`) with hardcoded test cases:
  - 2026-04-12 → pascha-day, red
  - 2026-04-15 → bright-week, white
  - 2026-05-01 → paschal-season, white  ← TODAY
  - 2026-05-31 → pentecost, green
  - 2026-07-15 → apostles-fast, red
  - 2026-08-19 → transfiguration, white
  - 2026-12-25 (Christmas Eve EU) → nativity-fast, purple
  - 2027-01-07 → nativity-season, gold
  - 2027-04-19 → lent-weekend OR lent-weekday depending on day-of-week
- The function should never throw. If something goes wrong, fall back to ORDINARY/GOLD with a console.warn.

---

## Part 3 — How the liturgical color appears on the site

The liturgical accent should appear in these specific places ONLY (don't overdo it):

1. **The current-season banner on the homepage**: background uses the liturgical color, text uses its `-text` companion. The banner content updates to reflect the season:
   - For paschal-season (today): "Christ is Risen! Indeed He is Risen! / We rejoice in the Paschal season."
   - For lent-weekday: "Great Lent — A time of fasting, prayer, and repentance."
   - For ordinary: "Ordinary Time"
   - Etc. Provide one for each season.

2. **A thin (3-4px) horizontal accent stripe** at the top of the page, full width, in the liturgical color. Subtle but visible.

3. **Section divider lines** between major homepage sections — 1px line in the liturgical color at 40% opacity.

4. **Heading underlines** — the bottom border under section headings (`Today's Readings`, `Schedule`, etc.) uses the liturgical color.

5. **Active nav indicator** — the underline or highlight under the currently-active nav link.

6. **The footer's top border** — 2px line in liturgical color.

DO NOT use the liturgical color for:
- Body text (always `--text-primary`)
- Buttons (use `--brand-blue`)
- Most card backgrounds (use `--cream-card`)
- Link colors (use `--brand-blue` with `--brand-blue-dark` hover)
- Anything that needs to be readable as a primary UI element

The point: visitors who attend Liturgy notice the seasonal shift; everyone else just sees a thoughtfully-designed site.

---

## Part 4 — Update the homepage

The homepage banner currently says "Holy Week — Pascha approaches May 2nd." This is wrong (Pascha was April 12). It should now read what `getLiturgicalSeason()` returns for today.

For paschal-season today (May 1, 2026), the banner should say:
> **Christ is Risen! Indeed He is Risen!**
> We rejoice in the Paschal season.

The banner should also show a small label below: "Paschal Season — White vestments"

---

## Part 5 — Other tasks

While you're in there:

1. **Source/dest consistency check**: search the codebase for any remaining `gold`, `burgundy`, `parchment` references and replace with the new tokens. Don't leave dead variables.

2. **Verify the schema markup still has correct emails**: `parishoffice@stjohnrgv.org` (general) and `shepherd@stjohnrgv.org` (pastoral contactPoint).

3. **The phone number** should be (956) 449-0225 everywhere. Double-check.

4. **The font fix from earlier** for the squished/badly-rendered link styling — make sure that fix is still in place after the palette swap. Test that links still render correctly in the new color scheme.

5. **Add JSDoc comments to `liturgical.ts`** explaining each season for future maintainers (Fr. Tony, future-you, future Claude Code sessions). Reference the typikon being used.

---

## Commits

Break this into clean commits. Suggested:

1. "Add Coastal Light base palette, replace gold/burgundy theme"
2. "Add Pascha date table for 2026-2050"
3. "Implement liturgical season calculation (Russian/Slavic typikon)"
4. "Apply liturgical accent color throughout homepage"
5. "Update homepage Paschal banner to current season"
6. "Tests for liturgical season logic"

Don't push to GitHub. I want to verify everything locally first.

---

## Final check

Before you start coding: tell me your build plan. I want to see:
- Files you'll create
- Files you'll modify
- Anything in the spec above that's ambiguous or that you'd handle differently
- Estimated number of commits

Then I'll greenlight and you build.
