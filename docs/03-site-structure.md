# 03 — Site Structure
## St. John of Kronstadt Orthodox Mission — Page Architecture & Content Specification

**Document Type:** Formal Site Structure Specification  
**Version:** 1.0  
**Prepared For:** Claude Code / Development Handoff  
**Date:** May 2026  

---

## 1. Full Sitemap

```
stjohnrgv.org/
├── /                          Homepage
├── /about/                    About the Parish
├── /schedule/                 Service Schedule & Location
├── /learn/                    What is Orthodoxy? (Catechism)
├── /calendar/                 Julian Calendar & Feast Days
├── /sermons/                  Sermon Archive
│   └── /sermons/[slug]/       Individual Sermon Pages
├── /communion/                Our Canonical Family
├── /announcements/            Parish News & Announcements
│   └── /announcements/[slug]/ Individual Announcement Pages
├── /contact/                  Contact & Prayer Requests
├── /es/                       Spanish Language Homepage
├── /sitemap.xml               XML Sitemap (auto-generated)
├── /robots.txt                Robots configuration
└── /404/                      Custom 404 Page
```

---

## 2. Page-by-Page Content Specification

---

### 2.1 Homepage (`/`)

**Purpose:** Welcome new visitors; establish identity; drive to Schedule and Contact pages.  
**Primary Keywords:** Orthodox church Rio Grande Valley, St. John of Kronstadt Texas  
**Template:** Hero + Services Banner + About Preview + Feast Preview + Contact CTA

#### Sections (in order)

**A. Navigation Bar (fixed/sticky)**
- Logo: Orthodox cross icon + "St. John of Kronstadt / Orthodox Mission · RGV"
- Links: About · Schedule · Learn · Calendar · Contact
- CTA Button: "Plan Your Visit" → `/schedule/`
- Mobile: hamburger menu

**B. Hero Section**
- Eyebrow text: "Rio Grande Valley, Texas"
- H1: "St. John of Kronstadt Orthodox Mission"
- Subtitle (italic): "Anchored in Ancient Faith · Welcoming All Seekers"
- Gold divider line
- Body text: 1–2 sentences about the parish and Julian Calendar tradition
- CTA buttons: [Service Schedule] [Plan Your Visit]
- Background: Dark Byzantine aesthetic with rotating mandala SVG, radial gold glow

**C. Services Banner**
Four cards in a grid:
- Divine Liturgy · Sundays 9:00 AM
- Great Feast Days · Per Julian Calendar
- Vespers · Saturdays 6:00 PM
- Confession · By Appointment

**D. About Preview**
- Section label: "Our Parish"
- H2: "A Living Tradition in the Rio Grande Valley"
- 2 paragraphs: parish identity, Julian Calendar, welcome to all
- 2×2 icon grid:
  - 📿 Traditional Calendar
  - 🕯️ Ancient Liturgy (Divine Liturgy of St. John Chrysostom)
  - 🫂 Welcoming Mission (inquirers, catechumens)
  - 🏛️ Canonical Church (Metropolia, Avlona Synod)
- Link: "Learn About Our Faith →" → `/learn/`

**E. Upcoming Feasts Preview**
- Section label: "Upcoming Feasts"
- H2: "Julian Calendar – Feast Days"
- Show next 4–6 feasts (dynamically calculated)
- Each feast card: Julian date · Gregorian date (NS) · Feast name · Brief note
- Link: "Full Calendar →" → `/calendar/`

**F. Contact / Location Strip**
- Address: 39737 Palm Drive, Bayview, TX 78566
- Phone: 956-449-0225 (tap-to-call)
- Priest: Fr. Antonios Altermatt
- Google Maps embed (static or interactive)
- Contact form (name, email, inquiry type, message)

**G. Sister Churches Strip**
- Brief mention of canonical communion
- Logos/links: Orthodox Metropolia · Avlona Synod · IPC Katakomb
- "Learn about our communion →" → `/communion/`

**H. Footer**
- Cross icon
- Parish name and address
- Phone and email
- Copyright
- Links: Privacy Policy · Sitemap

---

### 2.2 About Page (`/about/`)

**Purpose:** Deeper introduction for inquirers and seekers doing research.  
**Primary Keywords:** True Orthodox Church Texas, Julian Calendar Orthodox, St. John of Kronstadt

#### Sections

**A. Hero Banner**
- H1: "About St. John of Kronstadt Orthodox Mission"
- Subtitle: short description of the mission

**B. Our Story**
- When the mission was founded
- How it serves the Rio Grande Valley
- Fr. Antonios Altermatt bio (photo + paragraph)

**C. The Julian Calendar Explained**
- What is the Julian Calendar?
- Why does the Orthodox Church use it?
- How to read dual dates (e.g., "December 25 OS / January 7 NS")
- Table: Major feasts with OS and NS dates for the current year

**D. Our Tradition**
- What is "True Orthodox" / the Catacomb tradition? (brief, accessible)
- Link to `/communion/` for full explanation
- The Apostolic succession we maintain

**E. Our Patron Saint: St. John of Kronstadt**
- Brief hagiography of St. John of Kronstadt (1829–1908)
- His relevance to the parish
- Icon image

**F. Location & Accessibility**
- Full address with map
- Parking information
- Accessibility notes
- "What to expect at your first visit" — brief welcoming guide

---

### 2.3 Schedule Page (`/schedule/`)

**Purpose:** Practical information for visitors — the most-consulted page.  
**Primary Keywords:** Orthodox church Bayview TX service times, Orthodox church RGV schedule

#### Sections

**A. Regular Weekly Services**

| Service | Day | Time | Notes |
|---|---|---|---|
| Divine Liturgy | Sunday | 9:00 AM | All are welcome |
| Vespers | Saturday | 6:00 PM | |
| Confession | By appointment | Contact Fr. Antonios | |

**B. Upcoming Feast Day Services**
- Dynamically generated from Julian Calendar calculator
- Show next 8 feast days
- Format: Feast name · OS date · NS date · Service type · Time

**C. Location**
- Full address: 39737 Palm Drive, Bayview, TX 78566
- Interactive Google Maps embed
- Turn-by-turn written directions from Brownsville / McAllen
- Parking instructions

**D. Your First Visit**
- "What should I wear?" — modest dress, women's head covering optional but traditional
- "Do I need to bring anything?" — no, just yourself
- "Can I receive Communion?" — explanation of Orthodox communion practice (for catechumens / non-Orthodox)
- "Who can I speak with?" — Fr. Antonios Altermatt, 956-449-0225

---

### 2.4 Catechism / Learn Page (`/learn/`)

**Purpose:** The primary SEO landing page for seekers searching "What is Orthodox Christianity." Educational, welcoming, non-technical.  
**Primary Keywords:** What is Orthodox Christianity, Eastern Orthodox church beliefs, how to become Orthodox

#### Sections

**A. Hero**
- H1: "What is Orthodox Christianity?"
- Subtitle: "The ancient faith of the Apostles, Church Fathers, and Martyrs"

**B. Core Explainer Articles (accordion or card layout)**

Each article is 300–600 words, targeting specific search queries:

1. **"What is the Orthodox Church?"**  
   The oldest continuous Christian body; direct succession from the Apostles.

2. **"How is Orthodoxy different from Catholicism?"**  
   Great Schism of 1054; Papal authority; filioque; differences in worship.

3. **"How is Orthodoxy different from Protestantism?"**  
   Holy Tradition; sacramental theology; the role of Saints; Scripture and Tradition.

4. **"What is the Divine Liturgy?"**  
   The central act of Orthodox worship; its structure and meaning.

5. **"What is the Julian Calendar and why does the Orthodox Church use it?"**  
   History and theological reasoning; how to calculate feast days.

6. **"How do I become Orthodox Christian?"**  
   The catechumenate process; baptism or chrismation; timeline.

7. **"What is the True Orthodox Church / Catacomb Church?"**  
   Brief, accessible overview; link to `/communion/` for depth.

**C. Recommended Resources**
- Books for inquirers (e.g., *The Orthodox Church* by Met. Kallistos Ware)
- Websites: OrthodoxWiki, NFTU, IPC Katakomb
- "Speak with Fr. Antonios" CTA → Contact form

**D. FAQ**
Common questions with short answers, structured as FAQ schema for Google rich snippets:
- "Do I have to be baptized Orthodox to attend?" — No.
- "Can women become Orthodox?" — Yes.
- "Do Orthodox pray to saints?" — Explanation of intercession.
- "What is Orthodox fasting?" — Brief overview.

---

### 2.5 Julian Calendar Page (`/calendar/`)

**Purpose:** Definitive feast day reference for parishioners and seekers.  
**Primary Keywords:** Julian Calendar feast days 2026, Orthodox Julian Calendar Texas

#### Sections

**A. Calendar Year View**
- Toggle: current year / next year
- Full list of all major feasts with:
  - Julian (OS) date
  - Gregorian (NS) date
  - Feast rank (Great Feast / Solemn / Commemoration)
  - Service type

**B. Julian Calendar Calculator (interactive JS widget)**
- User inputs a Julian date → outputs Gregorian equivalent
- Or inputs Gregorian → shows Julian equivalent and nearest feast

**C. Explanation Section**
- "Why 13 days?" — The Julian/Gregorian calendar difference explained
- Fast periods: Great Lent, Apostles Fast, Dormition Fast, Nativity Fast
- Fast-free weeks

**D. iCal / Google Calendar Export**
- Download `.ics` file of all feast days for the year
- Add to Google Calendar button
- Reminder: dates are Julian; Gregorian equivalents shown

---

### 2.6 Sermon Archive (`/sermons/`)

**Purpose:** SEO content engine; resource for parishioners; showcase of parish life.  
**Primary Keywords:** Orthodox sermons Texas, Orthodox homilies online

#### Structure

**Listing Page (`/sermons/`)**
- Grid of sermon cards
- Each card: Feast/Sunday name · Date · Preacher · 1-sentence summary · Audio play button
- Filter by: Feast Day · Great Fast · Regular Sunday · Topic
- Search bar

**Individual Sermon Page (`/sermons/[slug]/`)**
```
Title: [Feast/Sunday Name] — Homily by Fr. Antonios Altermatt
Date: [Julian date / Gregorian date NS]
Audio player (if recording available)
Full transcript (manually entered or AI-transcribed)
Related feast information
Tags: #Lent #Pascha #Theotokos etc.
Schema: PodcastEpisode or Article markup
```

**Content Pipeline with Claude Code:**
1. Fr. Antonios records homily (audio file)
2. Audio uploaded to sermon admin panel
3. Claude API transcribes audio → generates 200-word SEO summary → suggests tags
4. Admin reviews, approves, publishes
5. New indexed page automatically added to sitemap

---

### 2.7 Communion Page (`/communion/`)

**Purpose:** Explain canonical standing; showcase relationship with IPC Katakomb and the Catacomb Church tradition. Targets niche but high-intent researchers.  
**Primary Keywords:** True Orthodox Church America, IPC Katakomb English, Catacomb Church history, Avlona Synod

#### Sections

**A. Our Canonical Family**
- Intro: "St. John of Kronstadt Mission is part of a worldwide communion of True Orthodox Christians."
- Three columns:
  - Orthodox Metropolia (link + description)
  - Avlona Synod USA (link + description)
  - IPC Katakomb, Russia (link + description)

**B. The IPC Katakomb — Our Sister Synod in Russia**
This is the richest content opportunity on the entire site.
- What is the Катакомбная Церковь (Catacomb Church)?
- Brief history: Soviet persecution, the "Sergianist" controversy, underground survival
- Current status of the IPC (True Orthodox Church of Russia)
- Website: ipckatakomb.ru
- Their monasteries: Синодальный Храм, Монастырь в Денежниково, Монастырь в Острово
- Recent Primate reflections (translated excerpts, with permission)
- "Visit our Russian brothers in prayer" — link to their site

**C. Apostolic Succession**
- Visual timeline or list of the canonical succession line
- Brief theological explanation of why succession matters

**D. What is "True Orthodox"?**
- Distinction from the Moscow Patriarchate (ROC)
- Distinction from ROCOR
- Why the Julian Calendar is maintained
- Non-ecumenist stance

---

### 2.8 Announcements Page (`/announcements/`)

**Purpose:** Current parish news; replaces the existing WordPress news feed.

#### Structure
- Paginated list of announcements (10 per page)
- Each item: Title · Date · Category · Excerpt · Read More
- Categories: Service Changes · Feast Days · Parish Events · Sister Synod News
- RSS feed at `/announcements/feed.xml`

---

### 2.9 Contact Page (`/contact/`)

**Purpose:** Primary conversion page — turning visitors into inquirers.

#### Sections

**A. Contact Information**
- Address (with map)
- Phone: 956-449-0225 (large, tap-to-call)
- Email
- Fr. Antonios Altermatt (pastor)

**B. Contact Form**
Fields:
- Full Name (required)
- Email (required)
- Phone (optional)
- I am a... (dropdown):
  - Seeking to learn more about Orthodoxy
  - Preparing for baptism / chrismation
  - Orthodox Christian visiting the area
  - Member of the press / researcher
  - Other
- Message (required)
- Submit button → Netlify Forms or Formspree handler

**C. Prayer Request Form**
Separate from contact form; clearly labeled.
Fields:
- Name (optional — can be anonymous)
- Prayer request (textarea)
- Public/Private toggle (public requests may be shared with the parish)
- Submit

**D. Social / External Links**
- Links to IPC Katakomb YouTube channel (shared sermons)
- Orthodox Metropolia
- NFTU

---

### 2.10 Spanish Language Page (`/es/`)

**Purpose:** Serve Spanish-speaking seekers in the predominantly Hispanic RGV.

This is a full Spanish-language version of the homepage, not just a translated banner.

```html
<html lang="es">
<title>Iglesia Ortodoxa en el Valle del Río Grande | San Juan de Kronstadt</title>
```

Key translated sections:
- Welcome message in Spanish
- Service schedule with Spanish labels
- "Qué es la Iglesia Ortodoxa?" — brief explainer in Spanish
- Contact information
- "Conozca Nuestra Fe" → link to `/learn/` (English catechism for now, with note that Spanish content is coming)
- hreflang alternates pointing to `/` (English equivalent)

---

## 3. Navigation Structure

### Primary Navigation (Desktop)
```
[Logo]    About    Schedule    Learn    Calendar    Communion    Contact    [Plan Your Visit →]
```

### Primary Navigation (Mobile)
```
[Logo]                                            [☰ Menu]

Hamburger opens full-screen overlay:
  About
  Schedule
  Learn
  Calendar
  Communion
  Contact
  [Plan Your Visit]
  ──────────────
  🇬🇧 English / 🇲🇽 Español
```

### Footer Navigation
```
Column 1: About · Our Tradition · Canonical Communion
Column 2: Schedule · Calendar · Sermons
Column 3: Learn · Contact · Pray With Us
Column 4: Orthodox Metropolia · Avlona Synod · IPC Katakomb · NFTU

Bottom bar: © 2026 St. John of Kronstadt Orthodox Mission · Privacy Policy · Sitemap
```

---

## 4. Claude Code Feature Specifications

### Feature 1: AI Parish Assistant (Priority: HIGH)

**Description:** A floating chat widget powered by the Claude API that answers questions about Orthodoxy, the parish, service times, and what to expect as a first-time visitor. Available 24/7.

**Implementation:**
```javascript
// Floating chat button, bottom-right
// On click: opens chat panel
// System prompt configures Claude as a knowledgeable, welcoming parish assistant
// Uses claude-sonnet-4-6 model via Anthropic API
// Suggested system prompt:

const SYSTEM_PROMPT = `You are a warm, welcoming assistant for St. John of Kronstadt Orthodox Mission in Bayview, TX (Rio Grande Valley). 

You help seekers, inquirers, and visitors learn about:
- The parish: address (39737 Palm Drive, Bayview TX 78566), phone (956-449-0225), Priest Antonios Altermatt
- Service times: Sunday Liturgy 9:00 AM, Saturday Vespers 6:00 PM
- Orthodox Christianity: faith, practice, sacraments, the Julian Calendar
- What to expect at a first visit
- How to begin the journey toward Orthodox Christianity
- Our canonical communion (Orthodox Metropolia, Avlona Synod, IPC Katakomb)

Always be warm, patient, and non-judgmental. Never pressure. Invite seekers to "come and see." 
For questions you cannot answer, direct them to call Fr. Antonios at 956-449-0225.
Respond in the same language the user writes in (English or Spanish).`;
```

**UI Elements:**
- Floating button: gold cross icon, bottom-right, with "Ask a Question" tooltip
- Chat panel: dark Byzantine aesthetic matching site design
- Message history in session (not persisted)
- "Speak with Fr. Antonios directly →" link in footer of chat panel

---

### Feature 2: Julian Calendar Calculator (Priority: HIGH)

**Description:** A JavaScript module that automatically calculates Julian Calendar feast days and outputs the correct Gregorian equivalent dates. No manual date updating required.

**Implementation:**
```javascript
// Julian to Gregorian offset: +13 days (20th/21st century)
function julianToGregorian(julianDate) {
  const d = new Date(julianDate);
  d.setDate(d.getDate() + 13);
  return d;
}

// Feast day database (Julian dates)
const feastDays = [
  { name: "Nativity of Christ", julian: "December 25", rank: "Great Feast" },
  { name: "Theophany (Epiphany)", julian: "January 6", rank: "Great Feast" },
  // ... full year of feasts
];

// Renders upcoming feasts automatically on homepage and /calendar/
```

**Outputs:**
- Homepage: next 4–6 feasts
- Calendar page: full year view
- iCal export: `.ics` file download
- Google Calendar link

---

### Feature 3: Sermon Archive with AI Transcription (Priority: HIGH)

**Description:** Upload audio homilies → Claude API transcribes → generates SEO-friendly summary → publishes as indexed page.

**Implementation Flow:**
1. Admin uploads `.mp3` or `.m4a` file via admin panel
2. Audio sent to Whisper API (OpenAI) or equivalent for transcription
3. Transcript passed to Claude API with prompt:
   ```
   "Given this sermon transcript, write: 
   (1) A 200-word SEO-friendly summary 
   (2) A suggested title 
   (3) 5 relevant tags
   (4) A 1-sentence excerpt for social sharing"
   ```
4. Admin reviews, edits if needed, clicks Publish
5. New page created at `/sermons/[auto-slug]/`
6. Sitemap auto-updated

---

### Feature 4: Bilingual Support (Priority: HIGH)

**Description:** Full English/Spanish toggle. Minimum: dedicated `/es/` page. Stretch: full site i18n.

**Phase 1 (Launch):**
- `/es/` page — full Spanish homepage
- Language toggle in navigation (🇬🇧 / 🇲🇽 or EN / ES)
- `hreflang` tags on all pages

**Phase 2 (Post-Launch):**
- Full site i18n using a library (e.g., `next-intl` if using Next.js)
- All pages translated to Spanish
- Spanish sermon archive

---

### Feature 5: Prayer Request Form (Priority: MEDIUM)

- Netlify Forms or Formspree handles submission
- Notification email to Fr. Antonios on each submission
- Optional: weekly digest email of prayer requests to parish list
- Anonymous submissions allowed

---

### Feature 6: Newsletter / Email List (Priority: MEDIUM)

- Mailchimp embed (free up to 500 subscribers)
- Signup widget in footer and Contact page
- Automated welcome email with parish information
- Monthly feast day digest (automated from calendar data)

---

### Feature 7: Google Maps Integration (Priority: QUICK WIN)

```html
<!-- Embedded Google Map -->
<iframe
  src="https://www.google.com/maps/embed?pb=!1m18!...BAYVIEW_TX_COORDS..."
  width="100%" height="400" style="border:0;" allowfullscreen
  loading="lazy" referrerpolicy="no-referrer-when-downgrade"
  title="St. John of Kronstadt Orthodox Mission location map">
</iframe>
```

Also include a "Get Directions" button that opens Google Maps in the native app on mobile.

---

## 5. Component Library

### Reusable Components to Build

| Component | Used On | Description |
|---|---|---|
| `<FeastCard>` | Homepage, Calendar | Date + feast name + rank + note |
| `<ServiceCard>` | Homepage, Schedule | Icon + service name + time |
| `<SermonCard>` | Sermons archive | Title + date + summary + audio player |
| `<AnnouncementCard>` | Announcements | Title + date + category + excerpt |
| `<ContactForm>` | Homepage, Contact | Full inquiry form |
| `<PrayerForm>` | Contact | Prayer request form |
| `<ChatWidget>` | All pages | AI Parish Assistant floating button + panel |
| `<LanguageToggle>` | Navigation | EN/ES switcher |
| `<JulianCalendar>` | Calendar page | Full year feast list with calculator |
| `<MapEmbed>` | Schedule, Contact | Google Maps iframe with directions button |

---

## 6. File Structure (Static Site)

```
stjohnrgv.org/
├── index.html
├── about/
│   └── index.html
├── schedule/
│   └── index.html
├── learn/
│   └── index.html
├── calendar/
│   └── index.html
├── sermons/
│   ├── index.html
│   └── [slug]/
│       └── index.html
├── communion/
│   └── index.html
├── announcements/
│   ├── index.html
│   └── [slug]/
│       └── index.html
├── contact/
│   └── index.html
├── es/
│   └── index.html
├── assets/
│   ├── css/
│   │   └── main.css
│   ├── js/
│   │   ├── calendar.js       (Julian Calendar calculator)
│   │   ├── chat-widget.js    (AI Assistant)
│   │   └── main.js
│   └── images/
│       ├── logo.svg
│       ├── og-image.jpg
│       ├── church-exterior.webp
│       └── icons/
├── sitemap.xml
└── robots.txt
```

---

*End of Document 03 — Site Structure*  
*See also: 01-project-brief.md · 02-seo-strategy.md · 04-domain-analysis.md*
