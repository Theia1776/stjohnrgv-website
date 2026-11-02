# Handoff — current state

What is true about this site now. Not a history: superseded work has been
pruned out, and the dated handoffs it came from are in git if the
reasoning behind an old decision is ever wanted
(`git log -- docs/HANDOFF-2026-*.md`).

**stjohnrgv-website** — Astro static site + Cloudflare Pages Functions +
Supabase + Cloudflare R2. Pushing `main` deploys to
https://stjohnrgv.org in about two minutes.

---

## Ground rules

- **Never `git push` or deploy without Tina saying so, every time.**
  Committing is fine unasked.
- **Don't tell Tina to rest, stop, or go to bed.** Say what the state is
  and what's next; she sets the pace.
- **Go to the evidence before offering a cause.** A sign-in hunt once
  cost an hour of confident theories — expired code, wrong domain, too
  many presses — each wrong. The Resend log and the page's own echoed
  address settled it in one look. "I don't know yet" beats a theory that
  sounds like an answer.
- **Verify a deploy by page content, not status code.** This site
  answers unknown URLs with 200. `wrangler pages deployment list` can
  also show a build as current while the CDN still serves the old page —
  poll for the text you actually changed.
- Commit messages end with the `Co-Authored-By: Claude …` trailer.
- `git add` explicit paths. `ProductPhotos/`,
  `scripts/make-handoff-pdf.mjs` and `scripts/make-launch-flier.mjs` are
  Tina's untracked files — never sweep them into a commit.

---

## Where things live

| | |
|---|---|
| Supabase | project `untczlsqrwcmqgqvvgmh` |
| Books and lessons | **Cloudflare R2**, bucket `library`, bound to Pages as `LIBRARY_BUCKET` |
| Email | Resend; domain `stjohnrgv.org` verified, sends as `no-reply@stjohnrgv.org` |
| Master admin | `theiagoodner@proton.me` — only she may grant or revoke the admin role |

**Cloudflare Pages → Production env vars:**
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESET_EMAIL_FROM`,
optional `NOTIFY_EMAIL_FROM`, `PARISH_REPLY_TO`, `PRIEST_EMAIL`,
`PARISH_OFFICE_EMAIL`. Changing one needs a redeploy to take effect.

**Local, git-ignored:** `scripts/r2-credentials.json` (R2 token, scoped
to the `library` bucket). Note `scripts/service-role.txt` does **not**
currently hold a service-role key — it holds a URL. Anything needing the
Supabase key must get it from the Cloudflare env or be run server-side.

---

## The library

| | |
|---|---|
| Books | **690** |
| With searchable text and page numbers | **618** |
| Scans with no text to pull | **72** |
| In R2 | 8.06 GB of the 10 GB free allowance |

All books are visible to signed-in parishioners. Three visibility tiers
exist — Hidden (admins only), Parishioners, Public — set per row on
`/admin/library/`.

**Text extraction** runs in the admin's browser (PDF.js), never on the
server: a Function's CPU budget will not read a long PDF. Shared by both
uploaders in [src/lib/pdf-text.ts](../src/lib/pdf-text.ts), which also
writes the page markers (`␞printedLabel|pdfPage␞`) that let a quotation
be cited to the printed page.

**If more books ever arrive**, the pipeline is:
1. `node scripts/list-mega-folder.mjs "<link>" --download library-incoming/<dir> --folder "<name>"`
   — **beware `--folder ""`**, an empty filter matches everything.
2. `node scripts/push-to-r2.mjs library-incoming` — files only, six at a
   time, streaming anything over 100 MB.
3. `/admin/library/` → **Add books found in storage** — makes the
   catalogue rows, server-side, so no database key is needed locally.
4. **Prepare text** — reads them in the browser.

---

## Catechism lessons

16 lessons, all searchable. Uploaded from `/admin/catechism/`; they
appear immediately under **My Learning** with no deploy.

- Text is read at upload and stored (migration 017). A **Make N lessons
  searchable** button backfills older ones; a **Searchable** column says
  which are done.
- [functions/api/catechism/search.ts](../functions/api/catechism/search.ts)
  searches titles *and* the text inside each lesson, server-side —
  doing it in the browser would mean sending every lesson's full text to
  every member. Results carry the matching passage and its page.
- The reader has a **Text** view: the pages are canvases, so the
  browser's own Ctrl+F finds nothing in them. Ctrl+F is redirected to
  the text. It loads before the PDF and is never waited on, so a broken
  PDF can't take the readable words down with it.

---

## An Orthodox Table

The parish recipe collection, at `/table/`. Two books: **Fasting**
(vegan — no meat, dairy or eggs) and **Everyday**.

| | |
|---|---|
| Recipes | **314**, all posted |
| Fasting book | **35**, public to anyone |
| Everyday book | **279**, signed-in members |
| Categories | `src/lib/recipe-categories.ts` — three groups, each ending in Misc. |

**The public/member split is the thing to understand.** The fasting
book is open to the world, because people search for Orthodox Lenten
cooking and that is a good door into a parish. The everyday book is the
families' own and stays inside. Enforced in
[functions/api/recipes/index.ts](../functions/api/recipes/index.ts), so
a direct link to an everyday recipe is refused too, and the listing is
cached **private** — what comes back depends on who is asking.

Catechumens and members submit at `/table/share/`; the form grows with
the recipe rather than offering a fixed number of boxes. Nothing appears
until an admin posts it from `/admin/recipes/`, which has search,
filters, per-card editing, and two whole-queue jobs: **file the unfiled
by title** and **post everything waiting**.

Each recipe prints as a card carrying the parish's name, address and
phone where a cookbook carries its publisher's. Printing is offered to
account holders; a page that can be read can always be printed, and no
site can change that.

**Keeping the Fast** at `/table/keeping-the-fast/` answers the question
every newcomer asks — where the protein comes from — and says that the
fast bends for the sick, pregnant, nursing, children and those doing
heavy work, with Fr. Antonios to decide.

### Where the 314 came from
Theia's old recipe cards, 281 PDFs on her desktop, read by
[scripts/parse-recipe-pdfs.py](../scripts/parse-recipe-pdfs.py) and
sorted by
[scripts/sort-recipes-for-books.py](../scripts/sort-recipes-for-books.py)
under her rules: everything to Everyday as written; to Fasting only what
can honestly be made without an animal **with bones** — honey allowed,
eggs and cream disqualifying, butter, milk and cheese swapped, and
Worcestershire becoming liquid smoke at a quarter of the measure.

**That sorting took four passes to trust, and the failures are the
lesson.** The first called Mongolian Beef, Ribs, Goulash and Chili vegan
because it knew "beef" and not "hamburger", "steak" or "brisket". The
second let Fish Tacos through on "Mahi-Mahi" and "Mayo". The third tried
to make a box of macaroni and cheese fasting by renaming it. The fourth
blocked a *vegan* meatloaf because "Plant-Based Burger" reads as a
burger. Any word-matching over food is wrong until proven otherwise on
the real list — check what it lets through, not just what it blocks.

**The St Philaret cookbook stays in the library**, linked from `/table/`
rather than imported. Of its 262 credited recipes, 175 name a commercial
food blog; a parish gathering those into its own book is a different
thing from republishing them on a public website.

---

## Who may do what

**Four roles**, in `profiles.role`: `inquirer`, `catechumen`, `member`,
`admin`. Inquirer is the step before catechumen — someone looking into
the faith. They read the whole library and all the lessons and receive
parish email; what they do not get is the **directory** (it carries
other people's addresses and phone numbers) or **downloads** of
anything. Both enforced in the API, not by leaving a button undrawn.


| | |
|---|---|
| Read a library book | public tier: anyone · parishioner tier: signed in · hidden: admins |
| **Download** a library book | **admins only** |
| Read a lesson | any signed-in member (drafts: admins) |
| **Download** a lesson | catechumens, members, admins — **not inquirers** |
| Read the fasting recipes | **anyone, signed in or not** |
| Read the everyday recipes | signed-in accounts only |
| Share a recipe | catechumens, members, admins |

The download rule is enforced in
[functions/api/library/file.ts](../functions/api/library/file.ts) on
`?download=1`, after the read rules and before any bytes are served — a
member who types the parameter by hand gets 403. The buttons only
reflect it.

**A consequence worth knowing:** a *public* book can be read by a
logged-out visitor but not downloaded by one. That is the rule as asked
for. If public books should be downloadable by anyone who can read them,
that is the line to change.

**Parish email** always BCCs when there is more than one recipient —
members can read a To header, so this is privacy, not tidiness.
Registration is the permission for parish mail; the opt-in flag governs
only automatic lesson announcements.

---

## Known rough edges

- **The password-reset flow fails quietly in two places.** A failed
  Resend call is only `console.error`'d and the page still says "sent"
  ([forgot.ts](../functions/api/auth/forgot.ts)); and the rate limit —
  `MAX_CODES_PER_WINDOW = 3` per 15 minutes in
  [reset-code.ts](../src/lib/reset-code.ts) — drops requests with no
  word to the user. Both are tight for mail that takes minutes.
  Members can change a password from `/account/` without any of this.
- **Recipe slugs keep their original title.** Renaming a recipe in the
  admin changes the title but not the URL, so one renamed from "Small
  Batch #1800" still lives at that address. Links don't break, which is
  why it works this way, but the address can read oddly.
- **Duplicates in the catalogue** are dealt with: 67 byte-identical
  pairs were removed, freeing 568 MB. Two pairs remain that only *look*
  alike — the 0.2 MB and 33.7 MB "On the Holy Spirit" among them — and
  are left for a person to judge. The tool is on `/admin/library/`.
- **Imported titles are only as good as their filenames**, and every
  imported book landed in category **Other**.
- **`PDF_MAX_BYTES` is still 50 MB** for books and 25 MB for lessons.
  That was a Supabase limit; R2 takes far larger files, so it can rise.
- **Supabase still holds the original copies** of the books moved to R2.
  Deleting them frees that allowance — a deliberate job, not a tidy-up.
- **Shrinking tooling exists** (`scripts/shrink-pdfs.py`, about 3× on
  books stored as lossless images) but was not used for the import. It
  cannot usefully shrink 600-DPI bilevel scans — 87 MB → 59 MB was its
  best.

---

## Traps that have already cost a day

- **Astro silently drops a second top-level `<script>`** in a page. Add
  to the existing block.
- **Don't write regexes through a shell heredoc.** `\n` and `\\` get
  mangled into literal newlines and broken character classes, producing
  "Unterminated regular expression" — or worse, code that builds and is
  subtly wrong. Use the editor tools for anything with escapes.
- **Postgres refuses `\u0000` and lone surrogates**, which some PDFs
  yield. One stray code unit rejects a whole book;
  [src/lib/library-text.ts](../src/lib/library-text.ts) strips them on
  the way in.
- **Don't `.trim()` a storage key.** One book is genuinely named
  `" Lord, What Shall I Do…"` with a leading space, and trimming made it
  unreachable while it sat in the bucket the whole time.
- **A whole-queue job must be sent in batches.** One request asked to
  do three hundred inserts, deletes or updates runs out of room part
  way: the duplicate cleanup stopped at 48 of 68 and called the rest
  "skipped". Every such job now loops in the page.
- **Don't sum a count across those batches.** The filing job added up
  "left alone" each round and reported 193 unfiled out of 314 recipes,
  because a recipe nothing can place stays in every round. Count the
  state of the table, not the passes.
- **Don't hide a button a person needs in a fold.** The filing button
  sat inside "Import a recipe file"; Theia sorted hundreds of recipes by
  hand without knowing it existed.
- **Deploy code only after its migration is applied.** Selecting a
  column that doesn't exist yet fails the whole query and takes the page
  down, not just the new feature.

---

## Migrations

All in [supabase/migrations/](../supabase/migrations/), all idempotent,
all applied by hand in the Supabase SQL editor.

`001`–`006` profiles, coffee hour, library · `007` password_resets ·
`008` master admin · `009`–`010` directory email · `011` library hidden ·
`012` catechism_lessons · `013`–`014` parish_emails · `015`–`016`
library text + page numbers · `017` catechism text · `018` recipes ·
`019` recipe categories.

---

The parish is a preservation project first: Fr. Antonios asked for the
books to exist in more than one place. Readership is not the point.
