# 01 — Project Brief
## St. John of Kronstadt Orthodox Mission — Website Rebuild

**Document Type:** Formal Project Specification  
**Version:** 1.0  
**Prepared For:** Claude Code / Development Handoff  
**Date:** May 2026  

---

## 1. Parish Identity

| Field | Detail |
|---|---|
| **Full Name** | St. John of Kronstadt Orthodox Mission |
| **Short Name** | St. John RGV |
| **Location** | 39737 Palm Drive, Bayview, TX 78566 |
| **Region** | Rio Grande Valley, South Texas |
| **Phone** | 956-434-6874 |
| **Priest** | Fr. Antonios Altermatt |
| **Jurisdiction** | Orthodox Metropolia · Avlona Synod (USA) |
| **Sister Synod** | Истинно-Православная Церковь (IPC Katakomb, Russia) — ipckatakomb.ru |
| **Calendar** | Traditional Julian Calendar (13 days behind Gregorian) |
| **Current Domain** | orthodoxtexas.com (WordPress) |
| **Target Domain** | stjohnrgv.org (recommended — see 04-domain-analysis.md) |

---

## 2. Parish Description

St. John of Kronstadt Orthodox Mission is a True Orthodox Christian parish serving the Rio Grande Valley from Bayview, Texas. The parish is named after St. John of Kronstadt (1829–1908), the beloved Russian priest and wonderworker glorified as a saint of the Orthodox Church.

The mission celebrates all divine services according to the **traditional Julian Calendar**, maintaining the ancient liturgical calendar of the Orthodox Church as handed down through the centuries. This places the parish in canonical communion with the True Orthodox (Catacomb) tradition — the line of bishops and clergy who refused to compromise with the Soviet-era communist state and maintained the apostolic faith in persecution.

The parish is under the **Avlona Synod (USA)** and the **Orthodox Metropolia**, with a sister synod relationship to the **Истинно-Православная Церковь** (True Orthodox Church / IPC Katakomb) in Russia — a body with deep historical roots in the underground Catacomb Church of the Soviet era.

**Pastoral Context:**  
The Rio Grande Valley is predominantly Hispanic and Spanish-speaking. The parish serves both English-speaking and Spanish-speaking seekers. Outreach to the local community — including potential Spanish-language content — is a strategic priority.

---

## 3. Project Goals

### Primary Goals
1. **Replace** the existing minimal WordPress site with a fast, modern, professionally designed static website.
2. **Establish** a clear digital identity for the parish in the Rio Grande Valley.
3. **Improve SEO** dramatically — from an estimated score of ~20/100 to a target of 90+/100.
4. **Attract inquirers and seekers** in South Texas searching for Orthodox Christianity.
5. **Serve existing parishioners** with up-to-date service schedules, feast day information, and announcements.

### Secondary Goals
6. Add **bilingual content** (English + Spanish) to serve the predominantly Hispanic RGV population.
7. Build a **Catechism / Education library** for seekers learning about Orthodoxy.
8. Integrate an **AI Parish Assistant** (Claude-powered) for 24/7 inquirer support.
9. Create a **Sermon Archive** with auto-transcription for SEO and parishioner study.
10. Connect to and highlight the **sister synod relationship** with IPC Katakomb (Russia).

---

## 4. Current Site Audit

**URL:** https://orthodoxtexas.com  
**Platform:** WordPress  

### Problems Identified
- **Vague domain name** — "orthodoxtexas" does not identify the parish, its location in the RGV, or its patron saint.
- **Minimal content** — Only 4 pages: About, Announcements, Schedule, Contact.
- **No SEO implementation** — No schema markup, no meta descriptions, no keyword strategy.
- **No Google Business Profile** linkage.
- **No bilingual content** — Despite operating in a predominantly Spanish-speaking region.
- **Slow performance** — WordPress with no optimization; estimated Lighthouse score ~45/100.
- **No inquirer pathway** — No "What is Orthodoxy?" page, no catechism resources, no clear call to action for seekers.
- **No sister church / communion page** — No mention of canonical connections to Orthodox Metropolia, Avlona Synod, or IPC Katakomb.
- **No sermon archive** — No audio, video, or text homily library.
- **No calendar integration** — Julian Calendar feast days not listed or explained.

---

## 5. Target Audience

### Primary Audiences
1. **Local seekers** — People in the Rio Grande Valley searching for "Orthodox church near me" or "Eastern Orthodox church Texas."
2. **Inquirers** — People curious about Orthodox Christianity who find the site via Google and need a welcoming, informative introduction.
3. **Existing parishioners** — Need easy access to schedules, announcements, and feast day information.

### Secondary Audiences
4. **Spanish-speaking seekers** — RGV is majority Hispanic; a Spanish-language landing page targets "iglesia ortodoxa Rio Grande Valley."
5. **True Orthodox seekers** — People specifically seeking the True Orthodox / Catacomb tradition who are researching canonical bodies.
6. **Researchers / academics** — Interested in the IPC Katakomb and Catacomb Church history (linked content opportunity).

---

## 6. Tech Stack Specification

| Layer | Technology | Rationale |
|---|---|---|
| **Build Tool** | Claude Code | AI-assisted development for rapid iteration |
| **Framework** | Static HTML/CSS/JS OR Next.js (static export) | Fast, no server overhead, 90+ Lighthouse score |
| **Styling** | Custom CSS with CSS variables | Full design control; no framework bloat |
| **Fonts** | Cinzel (headings) + EB Garamond (body) | Period-appropriate, elegant, web-optimized |
| **Hosting** | Netlify or Vercel (free tier) | Free, fast CDN, auto-deploys from Git |
| **CMS (optional)** | Netlify CMS or Decap CMS | Headless CMS for non-developer content updates |
| **Forms** | Netlify Forms or Formspree | Contact form + prayer request form, no backend needed |
| **Email** | Mailchimp (free tier) | Newsletter / parish announcements |
| **AI Assistant** | Claude API (claude-sonnet-4-6) | Embedded parish chatbot |
| **Calendar** | Custom Julian Calendar calculator (JS) | Auto-computes feast days; no manual updates |
| **Analytics** | Google Analytics 4 + Google Search Console | SEO tracking and performance monitoring |
| **Maps** | Google Maps Embed API | Location / directions |

---

## 7. Design Direction

### Aesthetic
**"Byzantine Gold"** — a refined, luminous, icon-inspired aesthetic. Dark backgrounds evoking candlelight and sacred space. Gold accents referencing Byzantine mosaics and illuminated manuscripts. Parchment text tones. Subtle noise/grain texture overlays for depth.

### Color Palette
| Token | Hex | Usage |
|---|---|---|
| `--gold` | `#C9A84C` | Primary accent, borders, icons |
| `--gold-light` | `#E8C97A` | Hover states, headings |
| `--gold-dim` | `#8B6E2F` | Subdued gold elements |
| `--deep` | `#0D0A05` | Page background |
| `--dark` | `#1A140A` | Card backgrounds |
| `--incense` | `#2C1F0E` | Section backgrounds |
| `--parchment` | `#F4EDD8` | Primary text on dark |
| `--parchment-dark` | `#E8D9B8` | Secondary text |
| `--text-mid` | `#C8B88A` | Body copy, captions |
| `--crimson` | `#8B1A1A` | Accent (used sparingly) |

### Typography
- **Display / Headings:** Cinzel (Google Fonts) — classical Roman letterforms, appropriate for sacred/liturgical context
- **Body:** EB Garamond (Google Fonts) — humanist serif, excellent readability, period-appropriate
- **Accent / Italic:** Cormorant Garamond — for pullquotes and liturgical text

### Motion & Interaction
- Page load: `fadeUp` animation (opacity + translateY) on hero content
- Background: slow-rotating mandala SVG at low opacity (120s rotation)
- Radial gold glow pulse on hero
- Cards: subtle border-color + background transitions on hover (0.3s)
- Navigation: `backdrop-filter: blur` for glass effect

---

## 8. Key Relationships to Surface on Site

| Relationship | What to Show |
|---|---|
| **Orthodox Metropolia** | orthodoxmetropolia.org — canonical jurisdiction |
| **Avlona Synod (USA)** | avlonasynodusa.com — US synodal body |
| **IPC Katakomb (Russia)** | ipckatakomb.ru — sister synod; True Orthodox Catacomb Church |
| **NFTU** | nftu.net — News outlet covering True Orthodox |

The IPC Katakomb connection is especially significant and should be explained on a dedicated **"Our Communion"** page — including the history of the Catacomb Church, its witness under Soviet persecution, and its current status as a sister synod.

---

## 9. Deliverables

- [ ] Full static website (HTML/CSS/JS or Next.js)
- [ ] Responsive design (mobile-first)
- [ ] SEO meta tags, Open Graph, and Schema.org markup on all pages
- [ ] Contact form with inquiry type selector
- [ ] Prayer request form
- [ ] Julian Calendar feast day display (auto-calculated)
- [ ] Google Maps embed
- [ ] Spanish-language landing page (`/es/`)
- [ ] "Our Communion" page explaining canonical connections
- [ ] Catechism / "What is Orthodoxy?" page
- [ ] Sermon archive page (placeholder with upload structure)
- [ ] AI Parish Assistant widget (Claude API)
- [ ] Google Analytics 4 integration
- [ ] Google Search Console sitemap submission

---

## 10. Success Metrics

| Metric | Current | 6-Month Target |
|---|---|---|
| Google Lighthouse Score | ~45 | 90+ |
| SEO Score (estimated) | ~20/100 | 90+/100 |
| Google Business Profile | Not claimed | Claimed + complete |
| Monthly organic visitors | Unknown / minimal | 200+ |
| Inquirer contact form submissions | 0 | 5+ per month |
| Google Maps "Orthodox church RGV" ranking | Not ranking | Top 3 local |

---

*End of Document 01 — Project Brief*  
*See also: 02-seo-strategy.md · 03-site-structure.md · 04-domain-analysis.md*
