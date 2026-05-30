# 02 — SEO Strategy
## St. John of Kronstadt Orthodox Mission — Search Engine Optimization Blueprint

**Document Type:** Formal SEO Specification  
**Version:** 1.0  
**Prepared For:** Claude Code / Development Handoff  
**Date:** May 2026  

---

## 1. Current SEO Assessment

| Factor | Current Status | Score |
|---|---|---|
| Title tags | Generic / missing | ❌ |
| Meta descriptions | Missing | ❌ |
| Schema.org markup | None | ❌ |
| Google Business Profile | Not claimed | ❌ |
| Page speed (Lighthouse) | ~45/100 (WordPress unoptimized) | ❌ |
| Mobile responsiveness | Basic | ⚠️ |
| Keyword targeting | None | ❌ |
| Internal linking | Minimal | ❌ |
| Fresh content / blog | Rarely updated | ❌ |
| Backlinks | Minimal | ❌ |
| Spanish-language content | None | ❌ |
| Image alt text | Missing | ❌ |

**Estimated Overall SEO Score: ~20 / 100**  
**Target Score: 90+ / 100**

---

## 2. Keyword Strategy

### Primary Keywords (High Priority)
These are the core terms the site must rank for. Integrate naturally into page titles, H1s, meta descriptions, and body copy.

| Keyword | Monthly Search Est. | Intent | Target Page |
|---|---|---|---|
| Orthodox church Rio Grande Valley | Low-Med | Navigational / Local | Homepage |
| Eastern Orthodox church Texas | Low | Informational | Homepage / About |
| Orthodox church Bayview TX | Very Low | Local / Navigational | Homepage |
| Orthodox church McAllen TX | Low | Local / Navigational | Homepage |
| Orthodox church Brownsville TX | Low | Local / Navigational | Homepage |
| Orthodox church South Texas | Low | Local | Homepage |
| True Orthodox Church Texas | Very Low | Navigational | About / Communion |
| Julian Calendar Orthodox Texas | Very Low | Informational | About / Calendar |
| What is Orthodox Christianity | Med-High | Informational | Catechism page |
| Eastern Orthodox vs Catholic | High | Informational | Catechism page |
| How to become Orthodox Christian | Med | Informational | Catechism page |
| Catacomb Church history | Low | Informational | Communion page |

### Secondary Keywords (Spanish-Language)
Target the predominantly Spanish-speaking RGV population with a dedicated `/es/` page.

| Keyword (Spanish) | Translation | Target Page |
|---|---|---|
| Iglesia ortodoxa Rio Grande Valley | Orthodox church RGV | /es/ |
| Iglesia ortodoxa Texas | Orthodox church Texas | /es/ |
| Iglesia ortodoxa cristiana cerca de mí | Orthodox Christian church near me | /es/ |
| Qué es la iglesia ortodoxa | What is the Orthodox church | /es/ |
| Iglesia ortodoxa Brownsville | Orthodox church Brownsville | /es/ |
| Iglesia ortodoxa McAllen | Orthodox church McAllen | /es/ |

### Long-Tail / Niche Keywords
These target specific True Orthodox seekers and researchers — lower volume but very high conversion intent.

| Keyword | Target Page |
|---|---|
| True Orthodox Church United States | About / Communion |
| Catacomb Church America | Communion page |
| Julian Calendar church Texas | About / Calendar |
| St John Kronstadt Texas | Homepage |
| Orthodox mission Texas | Homepage |
| Avlona Synod USA | Communion page |
| IPC Katakomb English | Communion page |

---

## 3. On-Page SEO Specifications

### Homepage (`/`)

```
<title>St. John of Kronstadt Orthodox Mission | Orthodox Church Rio Grande Valley, TX</title>

<meta name="description" content="Orthodox Christian church serving the Rio Grande Valley in Bayview, TX. Traditional Julian Calendar services, weekly Divine Liturgy, and a welcoming parish. Priest Antonios Altermatt. Call 956-434-6874.">

<meta name="keywords" content="Orthodox church Rio Grande Valley, Orthodox church Texas, Eastern Orthodox Bayview TX, Julian calendar Orthodox, St John Kronstadt Texas, True Orthodox Church Texas">

<link rel="canonical" href="https://stjohnrgv.org/">
```

**H1:** `St. John of Kronstadt Orthodox Mission`  
**H2s:** `Divine Liturgy in the Rio Grande Valley`, `About Our Parish`, `Service Schedule`, `Visit Us`

---

### About Page (`/about/`)

```
<title>About St. John of Kronstadt Orthodox Mission | True Orthodox Church, Bayview TX</title>

<meta name="description" content="Learn about St. John of Kronstadt Orthodox Mission — a True Orthodox parish in the Rio Grande Valley celebrating the ancient Julian Calendar faith of the Apostles and Church Fathers.">
```

**Key content to include:**
- Parish history and founding
- The Julian Calendar explained (what it is and why the Church uses it)
- The True Orthodox / Catacomb tradition (brief, accessible explanation)
- Priest Antonios Altermatt bio
- Canonical connections (Metropolia, Avlona Synod)

---

### Schedule Page (`/schedule/`)

```
<title>Service Schedule | St. John of Kronstadt Orthodox Mission, Bayview TX</title>

<meta name="description" content="Sunday Divine Liturgy at 9:00 AM, Saturday Vespers at 6:00 PM, and Julian Calendar feast day services. St. John of Kronstadt Orthodox Mission, Bayview TX 78566.">
```

**Key content to include:**
- Weekly schedule (Sunday Liturgy, Saturday Vespers)
- Upcoming feast days (Julian Calendar dates with Gregorian equivalents)
- Address with embedded Google Map
- Directions / parking notes
- "What to expect at your first visit" section

---

### Catechism / What is Orthodoxy Page (`/learn/`)

```
<title>What is Orthodox Christianity? | St. John of Kronstadt Orthodox Mission</title>

<meta name="description" content="Discover Orthodox Christianity — the ancient faith of the Apostles and Church Fathers. Learn what makes Orthodoxy unique, what to expect at a service, and how to begin your journey.">
```

**This is the most important SEO page for attracting new inquirers.**  
Target keywords: "What is Orthodox Christianity," "How to become Orthodox," "Eastern Orthodox vs Catholic," "Orthodox Church beliefs."

---

### Communion / Our Canonical Family Page (`/communion/`)

```
<title>Our Canonical Communion | True Orthodox Church | St. John of Kronstadt</title>

<meta name="description" content="St. John of Kronstadt is in communion with the Orthodox Metropolia, Avlona Synod USA, and the True Orthodox Church of Russia (IPC Katakomb) — the historic Catacomb Church.">
```

**Target keywords:** "True Orthodox Church America," "Catacomb Church history," "IPC Katakomb English," "Avlona Synod."

---

### Spanish Language Page (`/es/`)

```
<title>Iglesia Ortodoxa en el Valle del Río Grande, Texas | San Juan de Kronstadt</title>

<meta name="description" content="Misión Ortodoxa Cristiana sirviendo al Valle del Río Grande en Bayview, TX. Liturgia Divina los domingos. Padre Antonios Altermatt. Llame al 956-434-6874.">

<html lang="es">
```

---

## 4. Schema.org Structured Data

Implement the following JSON-LD on every page (in the `<head>`). This tells Google exactly what kind of organization this is and enables rich search results.

```json
{
  "@context": "https://schema.org",
  "@type": "Church",
  "name": "St. John of Kronstadt Orthodox Mission",
  "alternateName": ["St John Kronstadt RGV", "St. John of Kronstadt Orthodox Mission Texas"],
  "description": "True Orthodox Christian mission church serving the Rio Grande Valley on the traditional Julian Calendar. Member of the Orthodox Metropolia and Avlona Synod USA.",
  "url": "https://stjohnrgv.org",
  "logo": "https://stjohnrgv.org/images/logo.png",
  "image": "https://stjohnrgv.org/images/og-image.jpg",
  "telephone": "+19564346874",
  "email": "contact@stjohnrgv.org",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "39737 Palm Drive",
    "addressLocality": "Bayview",
    "addressRegion": "TX",
    "postalCode": "78566",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 26.10,
    "longitude": -97.42
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Sunday",
      "opens": "09:00",
      "closes": "12:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Saturday",
      "opens": "18:00",
      "closes": "19:30"
    }
  ],
  "sameAs": [
    "https://orthodoxtexas.com",
    "https://orthodoxmetropolia.org",
    "https://avlonasynodusa.com"
  ],
  "memberOf": [
    {
      "@type": "Organization",
      "name": "Orthodox Metropolia",
      "url": "https://orthodoxmetropolia.org"
    },
    {
      "@type": "Organization",
      "name": "Avlona Synod USA",
      "url": "https://avlonasynodusa.com"
    }
  ],
  "founder": {
    "@type": "Person",
    "name": "Fr. Antonios Altermatt",
    "jobTitle": "Priest"
  }
}
```

---

## 5. Google Business Profile (GBP) Setup

**This is the single highest-impact SEO action.** A fully completed GBP listing drives the majority of "near me" and local map searches.

### Step-by-Step Setup
1. Go to **business.google.com** and claim the listing for the address: `39737 Palm Drive, Bayview, TX 78566`
2. Verify via postcard or phone
3. Set business category: **"Orthodox Church"** (primary), "Christian Church" (secondary)
4. Add **all service areas:** Bayview TX, Brownsville TX, McAllen TX, Harlingen TX, Rio Grande Valley TX
5. Add **hours:** Sunday 9:00 AM – 12:00 PM, Saturday 6:00 PM – 7:30 PM
6. Add **phone:** 956-434-6874
7. Add **website:** https://stjohnrgv.org
8. Write a **business description** (750 chars max):

> St. John of Kronstadt Orthodox Mission is a True Orthodox Christian parish serving the Rio Grande Valley from Bayview, TX. We celebrate the ancient Divine Liturgy on the traditional Julian Calendar, preserving the faith of the Apostles and Church Fathers. Under the care of Priest Antonios Altermatt, our welcoming community is open to all seekers. Sunday Liturgy at 9:00 AM. Member of the Orthodox Metropolia and Avlona Synod USA.

9. Upload **photos** (minimum 10): exterior of building, interior, iconostasis if available, parish gathering photos, priest photo
10. Enable **Google Messaging** so seekers can message directly from Maps
11. Set up **Q&A** — pre-populate common questions:
    - "Do I need to be Orthodox to attend?" → "No, all are welcome to visit."
    - "What calendar do you follow?" → "We follow the traditional Julian Calendar."
    - "Is there parking?" → Add actual answer.

### Monthly GBP Maintenance
- Post 1 update per month (feast day announcement, parish news)
- Respond to all reviews within 48 hours
- Update holiday/feast day hours when services differ

---

## 6. Technical SEO Checklist

### Core Technical Requirements
- [ ] HTTPS enabled (SSL certificate — free via Let's Encrypt / Netlify)
- [ ] Canonical URLs on every page
- [ ] XML sitemap at `https://stjohnrgv.org/sitemap.xml`
- [ ] `robots.txt` configured correctly
- [ ] 301 redirect from `orthodoxtexas.com` to `stjohnrgv.org` (after domain migration)
- [ ] Open Graph tags on every page (for social sharing)
- [ ] Twitter Card meta tags
- [ ] Favicon and Apple Touch Icon
- [ ] `lang="en"` (or `lang="es"` for Spanish page) on `<html>` tag
- [ ] `hreflang` tags for English/Spanish pages:
  ```html
  <link rel="alternate" hreflang="en" href="https://stjohnrgv.org/" />
  <link rel="alternate" hreflang="es" href="https://stjohnrgv.org/es/" />
  ```

### Performance (Lighthouse 90+ Target)
- [ ] All images converted to **WebP** format
- [ ] Images lazy-loaded (`loading="lazy"`)
- [ ] Images have explicit `width` and `height` attributes (prevents layout shift)
- [ ] All images have descriptive `alt` text
- [ ] CSS and JS minified
- [ ] Google Fonts loaded with `font-display: swap`
- [ ] No render-blocking resources
- [ ] Static site (no WordPress / PHP server overhead)
- [ ] CDN hosting (Netlify or Vercel — both free)

### Image Alt Text Examples
```html
<img src="church-exterior.webp" alt="St. John of Kronstadt Orthodox Mission exterior, Bayview Texas">
<img src="iconostasis.webp" alt="Iconostasis at St. John of Kronstadt Orthodox Mission">
<img src="priest-antonios.webp" alt="Priest Antonios Altermatt, pastor of St. John of Kronstadt Orthodox Mission">
```

---

## 7. Content Strategy for Ongoing SEO

Fresh, indexed content is critical for long-term ranking. The following content cadence is recommended:

### Weekly / Bi-Weekly
- **Sermon summaries** — After each Sunday Liturgy, publish a 200–400 word summary of the homily. Even brief posts dramatically increase crawl frequency and keyword surface area.

### Monthly
- **Feast day spotlight** — A 300–500 word article on an upcoming major feast: its history, liturgical texts, and how the parish observes it. Example: "The Transfiguration of Our Lord — August 6/19."
- **Google Business Profile post** — Mirror the feast day article as a GBP post.

### Quarterly
- **Catechism article** — Deep-dive informational content targeting high-volume keywords: "What is the Divine Liturgy?", "Orthodox fasting practices," "Orthodox Christian prayer life."
- **Sister Synod update** — Translated/summarized content from IPC Katakomb highlighting shared faith, feast celebrations, or the Primate's reflections. Link back to ipckatakomb.ru.

### One-Time / Foundation Content
- "What is Orthodox Christianity?" — Comprehensive explainer page (1,000–1,500 words)
- "Our History and Canonical Succession" — Parish and synodal history
- "The Catacomb Church of Russia" — Historical article on the IPC Katakomb tradition (excellent for niche keyword ranking and demonstrating canonical seriousness)
- "The Julian Calendar Explained" — Answers a common question seekers have; rankable keyword

---

## 8. Link Building Strategy

### Internal Links
- Every page should link to the Schedule page and Contact page
- The About page links to the Communion page
- The Catechism page links to the Schedule page ("Ready to visit? See our service times →")
- The Sermon Archive links to individual sermon pages

### External Link Targets (Outreach)
Seek listings and links from:
1. **Orthodox Metropolia website** — Request a parish listing
2. **Avlona Synod USA website** — Request a parish listing
3. **NFTU (nftu.net)** — News for True Orthodox; submit parish news
4. **IPC Katakomb (ipckatakomb.ru)** — Cross-link as sister synod / sister parish directory
5. **OrthodoxWiki** — Create or improve a page for the parish
6. **Local RGV directories** — valleycentral.com, myrgv.com, local Chamber of Commerce

---

## 9. Analytics & Tracking Setup

### Google Analytics 4
- Create a GA4 property at analytics.google.com
- Add the GA4 tracking snippet to all pages
- Set up **conversion events:**
  - `contact_form_submit` — when the contact form is sent
  - `prayer_request_submit` — when a prayer request is submitted
  - `phone_click` — when the phone number is tapped on mobile
  - `directions_click` — when Google Maps is opened

### Google Search Console
1. Verify ownership of `stjohnrgv.org`
2. Submit sitemap: `https://stjohnrgv.org/sitemap.xml`
3. Monitor **Core Web Vitals** (aim for all "Good")
4. Track **search queries** — which keywords bring visitors
5. Monitor **index coverage** — ensure all pages are indexed

### 6-Month SEO Review Checklist
- [ ] All target pages indexed in Google
- [ ] GBP listing showing in local map pack for "Orthodox church Rio Grande Valley"
- [ ] Core Web Vitals: all green
- [ ] At least 5 external backlinks acquired
- [ ] Sermon/content archive has at least 10 posts
- [ ] Spanish page indexed and appearing for Spanish keywords

---

*End of Document 02 — SEO Strategy*  
*See also: 01-project-brief.md · 03-site-structure.md · 04-domain-analysis.md*
