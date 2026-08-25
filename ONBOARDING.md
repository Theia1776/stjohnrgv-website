# St. John of Kronstadt Mission Website — Handoff Doc

This file is the orientation guide for anyone (future Claude session, new
helper, or future-you returning after a break) who needs to make changes
to the parish website. Read this first.

**Maintainer:** Theia (Tina) Goodner — wife of the parish priest, primary
admin of the site. Comfortable directing work but not deeply technical.
Prefers plain-language explanations and step-by-step instructions when
something needs to happen in an external service (Supabase, Cloudflare,
Google Search Console).

**Last updated:** May 2026, after the initial parishioner-features ship.

---

## The stack in one breath

- **Framework:** Astro 6.x (static-site generator) with Tailwind CSS v4
- **Hosting:** Cloudflare Pages — auto-deploys on push to `main`
- **Database & Auth:** Supabase (Postgres + auth.users)
- **Server functions:** Cloudflare Pages Functions in `functions/api/*.ts`
- **DNS:** Cloudflare (nameservers `yahir.ns.cloudflare.com` /
  `cecelia.ns.cloudflare.com`)
- **Domain:** `stjohnrgv.org` (production)

Local dev: `npm run dev` for pages only (Astro). The Cloudflare Functions
under `functions/` are **not** served by `astro dev` — to test API
endpoints locally you'd need `wrangler pages dev`, which the repo isn't
configured for. In practice we ship + test on the live site since the
patterns are well-established.

---

## Standing preferences and rules

**These overrode default Claude behavior on the last build session — please
respect them.**

- **Edit / create / delete / commit autonomy:** Claude may freely edit
  files in the repo and create local git commits without asking each
  time.
- **NEVER push without explicit per-push approval.** Each `git push`
  requires Tina to say "push" or "go ahead" first. The autonomy on
  commits does NOT extend to pushing. This rule has prevented multiple
  silent deployments. See `~/.claude/projects/.../memory/feedback_autonomy.md`.
- **No `--no-verify`, `--no-gpg-sign`, or other safety bypasses** on git
  unless explicitly requested.
- **Speak in plain language** when describing changes — Tina is not a
  developer. Avoid jargon unless defined. Use the file_path:line_number
  pattern for code references.

---

## Major features and where they live

### Public site

- `/` ([src/pages/index.astro](src/pages/index.astro)) — homepage with
  liturgical-season banner, upcoming feasts (auto-computed via
  [src/lib/feasts.ts](src/lib/feasts.ts) and
  [src/lib/liturgical.ts](src/lib/liturgical.ts)), service schedule.
- `/about/`, `/calendar/`, `/contact/`, `/donate/`, `/iconography/` —
  standard content pages.
- `/learn/` and children — catechism + saints content, including a digital
  library at `/learn/library/*` backed by Supabase Storage.
- Layout: [src/layouts/Layout.astro](src/layouts/Layout.astro) — handles
  meta tags, fonts (Cinzel + Crimson Pro), the sticky liturgical-color
  stripe, and dark-mode bootstrap.

### Parishioner-only area (login required)

All require a logged-in Supabase session. Linked from the user-dropdown
in [src/components/Header.astro](src/components/Header.astro), which only
renders when `/api/auth/me` confirms login.

- **`/account/`** — the member's hub, laid out like the admin hub: a
  quick-jump bar over folding sections that remember what you leave open
  (`localStorage` key `stjohn_account_open`), with instant jumps. The
  sections are **My Learning** (catechism lessons posted from
  `/admin/catechism/`), **Parish Library**, **Coffee Hour**, **Parish
  Directory**, **Calendar & Saints**, and **My Details** — the profile
  form (name, contact info, emergency contacts, communication and
  directory preferences).
  Code: [src/pages/account.astro](src/pages/account.astro),
  API: [functions/api/profile.ts](functions/api/profile.ts) and
  [functions/api/catechism/lessons.ts](functions/api/catechism/lessons.ts).

- **`/api/library/book?slug=…`** — one book's details for the reader,
  under the same visibility rules as the PDF and text endpoints. The
  reader used to find its book by scanning the whole catalog from
  `/api/library/books`, which never includes hidden staging books — so an
  admin opening one from `/admin/library/` was told "Book not found"
  while the book sat right there. Code:
  [functions/api/library/book.ts](functions/api/library/book.ts).

- **`/account/lesson/?slug=…`** — reader for one catechism lesson, using
  the same PDF.js viewer as the library reader. Members only; the PDF
  comes back as a 60-second signed URL.
  Code: [src/pages/account/lesson.astro](src/pages/account/lesson.astro),
  API: [functions/api/catechism/pdf.ts](functions/api/catechism/pdf.ts).

- **`/directory/`** — parish directory. Shows everyone who opted in,
  with avatar / name / contact methods they chose to share. **Admins
  see an inline Catechumen/Member dropdown** next to each non-admin row
  for role management. Members get a ☦ (three-bar Orthodox cross) next
  to their name. Code: [src/pages/directory.astro](src/pages/directory.astro),
  API: [functions/api/directory.ts](functions/api/directory.ts).

- **`/coffee-hour/`** — Sunday food signup. Shows the next 8 Sundays;
  each parishioner can sign up to bring food, edit their own entries,
  remove them. Everyone in the parishioners section sees all signups.
  Code: [src/pages/coffee-hour.astro](src/pages/coffee-hour.astro),
  API: [functions/api/coffee-hour.ts](functions/api/coffee-hour.ts).

### Admin-only area

- **`/admin/`** — the Parish Admin hub, and the only admin entry in the
  header menu. A quick-jump bar plus one folding section per area:
  pending approvals (listed in full), member counts, the newest catechism
  lessons, library counts by visibility, the saints count, and links to
  Supabase / Cloudflare / Resend. It only *reads* from the existing admin
  APIs — each section loads independently, so one failing API leaves the
  rest of the page usable. Jumps and the floating back-to-top land
  instantly here (the page sets `<html data-instant-scroll="true">`,
  which [src/layouts/Layout.astro](src/layouts/Layout.astro) honors);
  which sections you leave open is remembered in `localStorage`
  (`stjohn_admin_open`). Code: [src/pages/admin/index.astro](src/pages/admin/index.astro).

- **`/admin/contacts/`** — list of all registered parishioners with
  filter/search, plus the Pending Approvals tab for new sign-ups.
  Code: [src/pages/admin/contacts.astro](src/pages/admin/contacts.astro).
- **`/admin/saints/`** — manage the saints catalog used on
  `/learn/saints/`.
- **`/admin/library/`** — upload new books (drag-drop PDF + metadata
  form) and edit/delete existing ones. Backed by the `library_books`
  table; PDFs go into the existing `library` storage bucket.
  **Text extraction:** each PDF's text is pulled out *in the admin's
  browser* with PDF.js as it uploads and stored in
  `library_books.text_content` (migration 015) — a 300-page book would
  blow a Cloudflare Function's CPU budget, and the browser has PDF.js
  loaded anyway. A "Prepare text for older books" button backfills books
  uploaded before this existed, one at a time, in the open tab. Scanned
  books yield nothing and are marked `text_status = 'empty'` so the
  backfill doesn't retry them forever; OCR is not attempted. The text is
  served one book at a time by
  [functions/api/library/text.ts](functions/api/library/text.ts) under
  the same visibility rules as the PDF, and read by the reader's **Text**
  view (`/learn/library/reader/?slug=…&view=text`), which carries its own
  find bar — the page views are canvases, so the browser's Ctrl+F has
  nothing to catch there.

  **Finding text in a book:** extraction inherits the printed page's
  habits — a word broken across a line arrives as `near- ness`, kerning
  can split one as `near ness`, and soft hyphens and doubled spaces are
  common. So the find bar searches a normalised copy (lowercased,
  whitespace collapsed, soft hyphens dropped, line-break hyphens
  rejoined) and maps hits back to the original characters to highlight
  them. A second index with every space removed catches words split on a
  bare space; it is used when the precise search finds nothing, or when a
  multi-word phrase finds more that way, and the count then says
  "(ignoring spaces)". Single words stay precise, so "to me" never
  matches inside "tome". Code:
  [src/pages/admin/library.astro](src/pages/admin/library.astro),
  APIs: [functions/api/admin/library/index.ts](functions/api/admin/library/index.ts)
  and [functions/api/admin/library/[id].ts](functions/api/admin/library/[id].ts).
- **`/admin/email/`** — the parish mailer. Writes to one member, several,
  or everyone holding an account. Addresses are read live from
  `auth.users` (never copied into a second list that could go stale), and
  any message with more than one recipient is addressed TO the sending
  admin with all members on **BCC**, in batches of 49 (Resend caps a
  message at 50 addresses). Replies go to the sending admin.
  Deliberately does NOT filter on `opt_in_communications` — registration
  itself is the permission; that flag governs the automatic
  announcements only. Every send is recorded in `parish_emails`
  (migration 013) so "did that go out?" has an answer.
  A "Send as" dropdown picks the parish identity — the office or
  Fr. Antonios — which sets the From, Reply-To, and visible To, and is
  recorded per message in `parish_emails.sent_as` (migration 014).
  Code: [src/pages/admin/email.astro](src/pages/admin/email.astro),
  API: [functions/api/admin/email.ts](functions/api/admin/email.ts).

- **`/admin/catechism/`** — upload catechism lessons (PDF + a title and
  a few optional details) and edit/delete existing ones. Each upload
  appears immediately under **My Learning** on `/account/` for every
  signed-in member; ticking *Email members* also announces it to
  everyone who opted into parish communications. Backed by the
  `catechism_lessons` table; PDFs go into the same `library` storage
  bucket under a `catechism/` prefix, so no second bucket is needed.
  Code: [src/pages/admin/catechism.astro](src/pages/admin/catechism.astro),
  APIs: [functions/api/admin/catechism/index.ts](functions/api/admin/catechism/index.ts)
  and [functions/api/admin/catechism/[id].ts](functions/api/admin/catechism/[id].ts).

Admin gating: API endpoints check `profiles.role === 'admin'` server-side
(see [functions/api/admin/directory.ts:43](functions/api/admin/directory.ts)
for the canonical pattern). Pages redirect on 401/403 client-side.

---

## Authentication and roles

### Auth flow (all parishioner pages)

1. User registers at `/login/` (handler: [functions/api/auth/register.ts](functions/api/auth/register.ts)).
2. Login at `/login/` (handler: [functions/api/auth/login.ts](functions/api/auth/login.ts)).
3. Server sets two httpOnly cookies: `sb-access-token` (short-lived JWT)
   and `sb-refresh-token` (30-day).
4. Every authenticated API endpoint calls `verifySession(request)` from
   [src/lib/session.ts](src/lib/session.ts) which validates the cookies
   and auto-refreshes if needed.

### Roles (stored in `public.profiles.role`)

- `catechumen` (default for new signups) — no special privileges, listed
  in directory without ☦.
- `member` — full member of the parish, gets the ☦ in the directory.
- `admin` — can manage other parishioners' roles via the inline directory
  toggle, has access to `/admin/*` pages.

**Promoting someone to `admin`** can only be done via Supabase SQL —
the UI toggle deliberately offers only Catechumen/Member so the UI can't
mint new admins or accidentally lock out the last admin.

SQL for manual promotion (paste in Supabase SQL Editor):

```sql
-- Promote by email (safest)
update public.profiles set role = 'admin' where email = 'someone@example.com';

-- Or by name
update public.profiles set role = 'admin' where first_name = 'Theia' and last_name = 'Goodner';
```

Demote an admin (must be done manually too):

```sql
update public.profiles set role = 'member' where email = 'someone@example.com';
```

### Approval

Profiles also have an `approved` boolean. Newly registered users default
to `approved = false` and **cannot log in** until an admin sets it to
true in the Supabase dashboard. This is the parish's "moderation" gate —
prevents random internet strangers from creating accounts and showing
up in the directory.

```sql
-- Approve a new registrant
update public.profiles set approved = true where email = 'newperson@example.com';
```

---

## Database

### Where things live

- **Supabase project:** "St John Library" (AWS us-east-2, Nano tier).
  Organization: ST JOHN KRONSTADT INC.
- **Migrations:** [supabase/migrations/](supabase/migrations/) — numbered
  `001_*.sql`, `002_*.sql`, etc.
- **Tables:** `public.profiles`, `public.coffee_hour_signups`,
  `public.library_books`, `public.catechism_lessons`, `public.parish_emails`.
  `library_books.text_content` holds each book's extracted text (migration
  015) — see the text-extraction note under `/admin/library/`.
- **Auth users:** `auth.users` (Supabase-managed).

### Critical: migrations are applied BY HAND

Cloudflare's deploy does NOT touch the database. The `.sql` files in
`supabase/migrations/` are **record-keeping only**. To actually apply a
new migration:

1. Supabase Dashboard → SQL Editor → New query.
2. Paste the contents of the new migration file.
3. Click Run.
4. Confirm "Success. No rows returned."

Existing migration files are idempotent (`if not exists` everywhere), so
re-running is safe.

### Critical: new tables need explicit GRANTs

If you create a new table, after the `create table` statement you MUST
also grant access to `service_role` (used by API functions) and
`authenticated` (used by future direct-client queries). Without these,
the API will return "permission denied for table X". See the bottom of
[supabase/migrations/004_coffee_hour_signups.sql](supabase/migrations/004_coffee_hour_signups.sql)
for the canonical pattern.

### Environment variables (Cloudflare Pages)

Configured in the Cloudflare Pages dashboard, NOT in the repo:

- `SUPABASE_SERVICE_ROLE_KEY` — used by server functions; bypasses RLS.
  Never expose to client code.
- `RESEND_API_KEY` — secret API key from the [Resend](https://resend.com)
  dashboard. Used by the password-reset flow
  ([functions/api/auth/forgot.ts](functions/api/auth/forgot.ts)) to email
  members their reset code.
- `PARISH_OFFICE_EMAIL` / `PRIEST_EMAIL` — optional overrides for the two
  identities `/admin/email/` can send as (default
  `parishoffice@stjohnrgv.org` and `frantonios@stjohnrgv.org`). The
  chosen one becomes the From, the Reply-To, and — on group mail — the
  visible To. **This matters for privacy:** recipients on BCC can read
  the To header, so group mail must never be addressed to an individual
  admin's mailbox. Both addresses must be on a domain verified in
  Resend.
- `RESET_EMAIL_FROM` — the From address for reset emails, e.g.
  `St. John of Kronstadt <no-reply@stjohnrgv.org>`. **The domain must be
  verified in Resend first** (add the DKIM/SPF DNS records Resend gives
  you for `stjohnrgv.org`). Until the domain is verified, Resend's sandbox
  only delivers to the Resend account owner's own email, so real members
  won't receive codes.

**Password-reset setup checklist** (one-time):
1. Create a free Resend account; add and verify the `stjohnrgv.org` domain
   (DNS records in the Cloudflare DNS dashboard).
2. Create an API key → set `RESEND_API_KEY` in Cloudflare Pages.
3. Set `RESET_EMAIL_FROM` to a `@stjohnrgv.org` sender on the verified
   domain.
4. Apply [supabase/migrations/007_password_resets.sql](supabase/migrations/007_password_resets.sql)
   in the Supabase SQL editor.

Public Supabase constants (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SESSION_COOKIE`, etc.) live in [src/lib/supabase.ts](src/lib/supabase.ts)
since they're meant to ship in browser code.

---

## Deployment

1. `git commit` locally (Claude does this freely).
2. **Tina says "push" or "go ahead"** — required per push.
3. `git push origin main`.
4. Cloudflare Pages picks up the push, builds (`npm run build`), and
   deploys to `https://stjohnrgv.org` in ~1-2 minutes.

**To verify a deploy is live**, hard-refresh (Ctrl+Shift+R) the affected
page. Browser cache otherwise.

**Cloudflare dashboard:** https://dash.cloudflare.com → Workers & Pages
→ `stjohnrgv-website` → Deployments tab shows recent builds.

---

## SEO setup (May 2026)

- **Sitemap:** auto-generated via `@astrojs/sitemap` at build time,
  published as `https://stjohnrgv.org/sitemap-index.xml`. Configured in
  [astro.config.mjs](astro.config.mjs). Parishioner-private paths and
  `/seasons-preview/` are filtered out.
- **robots.txt:** [public/robots.txt](public/robots.txt). Cloudflare also
  prepends AI-bot-blocking rules automatically; the combined live file
  is what you see at `https://stjohnrgv.org/robots.txt`.
- **Google Search Console:** verified via DNS (TXT record). Sitemap
  submitted. URL inspection done for the homepage.
- **Google Business Profile:** created. Website URL updated to
  `https://stjohnrgv.org`. **Video verification pending** as of last
  session — needs to be filmed at the house-chapel (focus on icons /
  iconostasis / vestments, NOT the residential parts). See conversation
  history if useful, or just film 60 seconds of chapel space + a quick
  shot of Fr. in cassock saying the parish name and service times.
- **Old domain (`orthodoxtexas.com`):** controlled by an unknown party
  via Hostinger, no one at the parish has the login. Expires
  November 7, 2026. Strategy is to wait for it to naturally lose ranking
  as stjohnrgv.org gains authority (3-6 months), or grab it if/when it
  expires via a drop-catch service (SnapNames, DropCatch).

### SEO doc reference

The original SEO blueprint is at
[docs/02-seo-strategy.md](docs/02-seo-strategy.md). It's a thorough
keyword + content + technical strategy. Most of the technical items
are now done (titles, descriptions, schema.org JSON-LD, canonical URLs,
HTTPS, sitemap, robots.txt). Outstanding items per that doc include:

- Spanish-language `/es/` page
- Sermon archive / blog cadence
- More image alt-text auditing
- Google Business Profile (in progress, pending video verification)

---

## Common tasks — how to

### Change static text on a page

Open the corresponding `.astro` file in `src/pages/`. The frontmatter
(between the `---` lines) is server-side; the body is HTML. Edit, save,
commit, push.

### Add a new page

Create `src/pages/whatever.astro` following the pattern of an existing
page (e.g., [src/pages/about.astro](src/pages/about.astro)). It'll be
served at `/whatever/`. The sitemap will auto-include it on next build.

### Promote a parishioner to member (the normal flow)

1. Tina (admin) opens https://stjohnrgv.org/directory/.
2. Finds the parishioner's row.
3. Changes the inline dropdown from Catechumen → Member.
4. Their ☦ appears next to their name immediately.

### Promote someone to admin (rare, manual)

Run the SQL update in Supabase as shown above in the "Roles" section.

### Approve a new registrant

Same — SQL update in Supabase, or via the Supabase Table Editor UI
(navigate to `profiles`, find the row, toggle `approved` to true, save).

### Update the parish phone number / address

Several places need to match — these are the ones to update:

- [src/pages/index.astro](src/pages/index.astro) — schema.org JSON-LD
  blocks (`parishSchema` and `churchLocalSchema`) AND any visible
  homepage text.
- [src/pages/contact.astro](src/pages/contact.astro) — contact page.
- [src/components/Footer.astro](src/components/Footer.astro) — footer.
- [src/layouts/Layout.astro](src/layouts/Layout.astro) — none currently,
  but check.
- **Google Business Profile** — separately, in business.google.com.

### Service time changes

Same idea — `src/pages/index.astro` has a `services` array near the top
of the file with current times. Update that, plus the homepage schema's
`openingHoursSpecification`. Also update Google Business Profile.

---

## Files Claude should always read first when picking up this project

1. **This file** (`ONBOARDING.md`)
2. [docs/02-seo-strategy.md](docs/02-seo-strategy.md) for SEO context
3. [supabase/migrations/001_profiles.sql](supabase/migrations/001_profiles.sql)
   through `004_*.sql` for the schema
4. [src/lib/session.ts](src/lib/session.ts) for the auth pattern
5. [functions/api/profile.ts](functions/api/profile.ts) as a canonical
   example of an authenticated server function

---

## Things to watch out for

- **Cloudflare's managed robots.txt** prepends content above the
  repo-controlled `public/robots.txt`. If you're confused why robots.txt
  shows more than what's in the repo file, that's why.
- **Migrations don't auto-apply.** Tina is the human in the loop for
  every SQL change. Always provide the exact SQL to paste, plus
  step-by-step Supabase dashboard navigation.
- **Cookies are `Secure`** — local dev over plain HTTP can have weird
  cookie behavior. Cloudflare Pages handles HTTPS automatically.
- **CRLF line ending warnings** on Windows are noisy but harmless — git
  is converting LF to CRLF on checkout. Don't try to "fix" it.
- **The "St John Library" Supabase project name** is misleading — it
  hosts everything (auth, profiles, coffee hour, library files), not
  just the library. Historical artifact from when the library was the
  first feature built.

---

## Open / known items

- **GBP video verification:** pending. Tina plans to film it on a Sunday
  after liturgy when the chapel is set up.
- **Old domain orthodoxtexas.com:** see SEO section above. Strategy is
  patience + organic outranking, or drop-catch in Nov 2026.
- **Outreach to parishioners:** the directory and coffee hour pages will
  stay mostly empty until parishioners create accounts and opt in. A
  bulletin announcement / after-liturgy walk-through is the planned
  adoption path. Not a code issue.
- **Spanish (`/es/`) page:** in the SEO doc but not built yet.
- **Sermon archive / blog cadence:** in the SEO doc but not built yet.

---

## Contact escalation

If something is genuinely broken in production and Tina is offline:

- **Cloudflare dashboard** (deploy / DNS / Pages settings) — Tina's
  Cloudflare account.
- **Supabase dashboard** (database / auth) — Tina's Supabase account,
  org "ST JOHN KRONSTADT INC".
- **GitHub repo** — `Theia1776/stjohnrgv-website`.

There's no on-call rotation — this is a parish website, not a SaaS
product. Take your time.

---

*God bless the work.* 🙏
