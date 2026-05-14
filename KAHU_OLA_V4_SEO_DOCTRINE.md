# Kahu Ola — SEO Doctrine

**Document ID:** KAHUOLA-SEO-V1.1
**Aligns with:** Kahu Ola V4.3.1 Doctrine · V4.7 Doctrine · V4.8 Master Index
**Classification:** Civic Hazard Intelligence — Discoverability Layer
**Last updated:** 2026-05-13
**Architect:** Long Nguyen

**V1.1 Amendment:** technical SEO clarifications for hreflang, API noindex headers, structured-data expectations, title-length tolerance, Search Console query buckets, and mobile throttled validation. Original V1.0 content preserved; V1.1 changes are additive. See "V1.1 Amendment Summary" before the Footer for the consolidated change list.

---

## §1 — SEO Philosophy

Kahu Ola SEO is **disaster-time discoverability**, not marketing growth.

A resident in Lahaina searching "Maui fire map now" on a hot phone, on 3G, with smoke outside, must reach `kahuola.org` within the first three organic results — and reach a page that renders, loads cached data, and routes them to official authorities. Every SEO decision is evaluated against that scenario.

Three SEO invariants flow directly from the system doctrine:

- **SEO-I — Civic authority boundary.** No metadata, title, schema, or description may claim official status, imply government endorsement, or impersonate NASA, NOAA, NWS, EPA, USGS, NIFC, HIEMA, or any county emergency office. (Mirrors §33 of V4.3.1.)
- **SEO-II — Render under failure.** SEO must not depend on JavaScript-rendered content. All critical metadata, structured data, and human-readable summaries must be present in the initial HTML response. (Mirrors Invariant II.)
- **SEO-III — Honest freshness.** No metadata may imply data is current when it is not. Page-level "last updated" timestamps reflect snapshot freshness, not page deploy time. (Mirrors §20 stale policy.)

---

## §2 — Target Query Inventory

The complete keyword scope. Anything outside this list is out of scope for V1.

### 2.1 Primary intent — hazard-specific, geographic

| Query pattern | Intent | Target page |
|---|---|---|
| `maui wildfire map` | Live situational awareness | `/live-map` (Maui view) |
| `hawaii air quality today` | AQI lookup | `/live-map` (AirNow layer) |
| `big island volcano alert` | USGS HVO status | `/live-map` (volcanic layer) |
| `hawaii flash flood warning` | NWS alert status | `/live-map` (flash-flood layer) |
| `lahaina fire current status` | Post-2023 recovery context | `/live-map` (Maui FIRMS) |
| `kona storm hawaii` | Active storm tracking | `/storm` |
| `hawaii fire weather red flag` | Wildfire risk awareness | `/live-map` (fire-weather) |
| `hawaii tsunami warning` | Coastal alert lookup | `/live-map` (tsunami) |

### 2.2 Secondary intent — informational, navigational

| Query pattern | Target page |
|---|---|
| `kahu ola` (brand) | `/` |
| `hawaii hazard map free` | `/` |
| `maui evacuation map` | `/` → routes to official sources |
| `hawaiʻi emergency apps` | `/` |

### 2.3 Forbidden query targeting

Never optimize for queries that imply Kahu Ola issues directives:

- ❌ `hawaii evacuation order`
- ❌ `maui official emergency alert`
- ❌ `nws hawaii official`
- ❌ Any `[agency name] official` pattern

These belong to government domains. Kahu Ola routes traffic there, never competes for it.

---

## §3 — Site Architecture for SEO

### 3.1 Canonical URL structure

```
https://kahuola.org/                       — Statewide dashboard (root)
https://kahuola.org/live-map               — Full interactive map
https://kahuola.org/storm                  — Active storm event page
https://kahuola.org/privacy                — Privacy policy
https://kahuola.org/support                — Support / contact
```

**Rules:**
- Trailing slash: never (canonical is no-trailing-slash)
- Lowercase: always
- No query strings in canonical URLs
- No `index.html` exposed in canonical (`/` not `/index.html`)
- Cloudflare 308 redirects from `.html` extensions must be honored — canonical points to the clean URL

### 3.2 Internal linking rules

- Every page links to `/` and `/live-map` in primary nav
- Every page links to **at least one official source** in footer (HIEMA, NWS Honolulu, county emergency management)
- No reciprocal link schemes, no link farms
- Anchor text is descriptive: `"View live wildfire map"` not `"click here"`

---

## §4 — Metadata Contract

Every page must ship with this minimum metadata set in the initial HTML response (no JS hydration).

### 4.1 Required `<head>` elements

```html
<title>{page_specific} — Kahu Ola | Hawaiʻi Hazard Awareness</title>
<meta name="description" content="{page_specific, ≤155 chars, no agency impersonation}">
<link rel="canonical" href="https://kahuola.org{path}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#0c6fbf">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta charset="utf-8">
<meta http-equiv="content-language" content="en-US">
```

### 4.2 Title format rules

- **Length:** 50–60 characters (target); civic-clarity tolerance up to 65 characters is allowed when hazard scope would otherwise become unclear (V1.1 clarification). No title may use urgency bait, false authority, or agency impersonation, regardless of length.
- **Pattern:** `{Specific subject} — Kahu Ola | Hawaiʻi Hazard Awareness`
- **Brand suffix:** always end with `| Hawaiʻi Hazard Awareness` (uses ʻokina, not apostrophe)
- **No clickbait:** no `🔥`, `BREAKING`, `URGENT`, exclamation marks
- **No false authority:** no `Official`, `Government`, `Emergency Service`

**Approved title set:**

| Page | Title |
|---|---|
| `/` | `Hawaiʻi Hazard Map — Kahu Ola \| Wildfire, Flood, Air Quality` |
| `/live-map` | `Live Hazard Map — Kahu Ola \| Hawaiʻi Wildfire & Flood Awareness` |
| `/storm` | `Active Storm Tracker — Kahu Ola \| Hawaiʻi Civic Hazard Intelligence` |
| `/privacy` | `Privacy Policy — Kahu Ola \| Zero-PII Civic Platform` |
| `/support` | `Support — Kahu Ola \| Hawaiʻi Hazard Awareness Platform` |

### 4.3 Meta description rules

- **Length:** 140–155 characters
- **Must include:** "civic", "Hawaiʻi", and the specific hazard scope
- **Must include:** an honest disclaimer fragment (e.g., "Situational awareness only — follow official emergency guidance.")
- **Must NOT include:** agency names as endorsements, severity claims, urgency language

**Approved descriptions:**

| Page | Description |
|---|---|
| `/` | `Independent civic hazard awareness for Hawaiʻi. Wildfire, flood, air quality, and storm signals from public data. Not an official emergency service.` |
| `/live-map` | `Live hazard map for Hawaiʻi: wildfire hotspots, flash floods, air quality, fire weather. Situational awareness only — follow official emergency guidance.` |
| `/storm` | `Current storm conditions across Hawaiʻi with post-storm wildfire risk context. Civic awareness platform — not an official weather service.` |

---

## §5 — Structured Data (JSON-LD)

All schema must reflect Kahu Ola's actual civic posture. No `GovernmentOrganization`, no `EmergencyService`, no `NewsArticle` claims.

### 5.1 Site-wide schema (every page)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://kahuola.org/#organization",
  "name": "Kahu Ola",
  "alternateName": "Kahu Ola Hawaiʻi Hazard Awareness",
  "url": "https://kahuola.org",
  "logo": "https://kahuola.org/assets/logo.svg",
  "description": "Independent civic hazard intelligence platform for Hawaiʻi. Aggregates publicly available government data for situational awareness. Not affiliated with any government agency.",
  "areaServed": {
    "@type": "AdministrativeArea",
    "name": "Hawaiʻi"
  },
  "knowsAbout": ["Wildfire awareness", "Flood awareness", "Air quality", "Civic technology"],
  "disambiguatingDescription": "Kahu Ola is not a government agency and does not issue official emergency directives. Always follow guidance from HIEMA, county emergency management, and the National Weather Service."
}
</script>
```

### 5.2 WebSite schema (homepage only)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://kahuola.org/#website",
  "url": "https://kahuola.org",
  "name": "Kahu Ola",
  "publisher": { "@id": "https://kahuola.org/#organization" },
  "inLanguage": ["en-US", "vi-VN"]
}
</script>
```

### 5.3 WebApplication schema (live-map only)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Kahu Ola Live Hazard Map",
  "url": "https://kahuola.org/live-map",
  "applicationCategory": "PublicSafetyApplication",
  "operatingSystem": "Any (web browser)",
  "browserRequirements": "Requires JavaScript and modern browser",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "isAccessibleForFree": true,
  "publisher": { "@id": "https://kahuola.org/#organization" }
}
</script>
```

### 5.4 BreadcrumbList (live-map and storm)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://kahuola.org/" },
    { "@type": "ListItem", "position": 2, "name": "Live Map", "item": "https://kahuola.org/live-map" }
  ]
}
</script>
```

### 5.5 Forbidden schema types

Never use:
- `GovernmentOrganization`
- `EmergencyService`
- `NewsArticle` / `NewsMediaOrganization`
- `MedicalWebPage`
- Any schema implying authoritative emergency directives

### 5.6 Structured data expectation (V1.1)

Structured data is used for entity clarity, disambiguation, and civic posture. Kahu Ola does not treat rich-result eligibility as a growth KPI. Schema must clarify that Kahu Ola aggregates public data for situational awareness and is not an official emergency authority. If a schema choice would help a rich result but blur the civic-authority boundary (SEO-I), the boundary wins.

---

## §6 — Open Graph + Twitter Card

Render the same metadata for crawlers and social shares. No agency-impersonating preview images.

```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kahu Ola">
<meta property="og:title" content="{matches <title>}">
<meta property="og:description" content="{matches meta description}">
<meta property="og:url" content="https://kahuola.org{path}">
<meta property="og:image" content="https://kahuola.org/assets/og/{page}-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="vi_VN">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{matches <title>}">
<meta name="twitter:description" content="{matches meta description}">
<meta name="twitter:image" content="https://kahuola.org/assets/og/{page}-1200x630.png">
```

**OG image rules:**
- 1200×630 PNG, ≤200KB
- Must show `kahuola.org` watermark
- Must NOT include NASA, NOAA, NWS, EPA, USGS, NIFC, or any agency logo
- Must NOT depict graphic disaster imagery (no flames, no destruction photos)
- Approved style: civic-tone map render or typographic card with hazard category icon

---

## §7 — Multilingual SEO (EN/VI)

Aligns with the i18n locked checklist. Phase 1 supports English and Vietnamese.

### 7.1 hreflang declarations

> ⚠️ **Deferred in V1.1 — do not ship this in production until Vietnamese URLs render localized initial HTML and are crawlable.**
> The `?lang=vi` hreflang line below is preserved as a historical V1.0 reference only. It conflicts with the `Disallow: /*?lang=` rule in §8 and with SEO-II (render under failure), because the alternate page returns English-only initial HTML. The authoritative V1.1 rule is §7.3.

```html
<link rel="alternate" hreflang="en-US" href="https://kahuola.org{path}">
<!-- DEFERRED in V1.1 — see §7.3. Do not ship until /vi/* path-based locale exists. -->
<link rel="alternate" hreflang="vi-VN" href="https://kahuola.org{path}?lang=vi">
<link rel="alternate" hreflang="x-default" href="https://kahuola.org{path}">
```

### 7.2 Language switching SEO rule

The current i18n implementation uses client-side `_t()` / `_tmpl()` switching with no separate URL per language. Until a future migration to path-based locales (e.g., `/vi/live-map`), the `?lang=vi` query parameter is the canonical Vietnamese URL, and hreflang must point to it. Do not add `lang=vi` to canonical tags — canonical always points to the unparameterized English URL.

> **V1.1 supersession note:** §7.2 describes the original V1.0 intent. In V1.1 it is **superseded for production by §7.3**, which defers Vietnamese hreflang advertising entirely until path-based locales exist. The client-side `_t()` / `_tmpl()` switching behavior in the existing UI is **unchanged** — only the *hreflang advertisement* is deferred.

### 7.3 V1.1 hreflang deferral rule (authoritative)

This is the authoritative V1.1 rule for Vietnamese hreflang. It supersedes §7.1 and §7.2 for production output.

- Phase 1 EN/VI language switching remains client-side and **must not be disturbed**. The existing UI language switcher, `_t()` / `_tmpl()` calls, and `i18n/kahuola-i18n.js` are unaffected by this rule.
- **Do not advertise `?lang=vi` as hreflang** while the initial HTML response is English-only and `?lang=` URLs are blocked in `robots.txt` (§8). Advertising a crawl-blocked, non-localized alternate misleads crawlers and violates SEO-II (render under failure).
- **Canonical URLs remain clean, unparameterized English URLs.** This is unchanged from V1.0.
- **Vietnamese hreflang is deferred** until a future server-rendered or path-based locale architecture exists, such as `/vi/live-map`, where the Vietnamese alternate (a) returns Vietnamese content in the initial HTML response and (b) is crawlable (not blocked in robots.txt).
- Existing UI language switching (the on-page EN/VI toggle) is **unaffected** — this rule only governs what is *advertised to crawlers via hreflang*, not how the page behaves for users.
- This preserves SEO-II (render under failure) and avoids sending crawlers to blocked or JS-dependent localized alternates.

**Production SEO snippets must therefore emit only:**

```html
<link rel="alternate" hreflang="en-US" href="https://kahuola.org{path}">
<link rel="alternate" hreflang="x-default" href="https://kahuola.org{path}">
<!-- No vi-VN hreflang until path-based /vi/* locales exist. See §7.3. -->
```

---

## §8 — robots.txt

```
# https://kahuola.org/robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /*?lang=

Sitemap: https://kahuola.org/sitemap.xml
```

**Notes:**
- `/api/*` is blocked from crawl — these are Worker endpoints, not user content (Invariant I downstream effect)
- `?lang=` variants disallowed to prevent duplicate-content penalties; canonical handles indexing. This is also why Vietnamese hreflang is deferred — see §7.3.
- No `Crawl-delay` — Cloudflare CDN handles rate concerns

### 8.1 API noindex header rule (V1.1)

`/api/*` endpoints are not user-facing SEO content. In addition to the `robots.txt` disallow above, Worker API responses **should emit:**

```
X-Robots-Tag: noindex, nofollow, nosnippet
```

where practical.

**Rationale:** `robots.txt` controls crawling behavior; the `X-Robots-Tag` header provides an additional **indexing** safeguard if API URLs are discovered from other surfaces (e.g., referer leaks, scraped link logs, accidental embedding). The two mechanisms are complementary, not redundant — robots.txt does not prevent indexing of URLs discovered through links.

**Scope:** applies to Worker JSON endpoints under `/api/*`. Does not apply to user-facing HTML pages. Implementation lives in the Worker, not in the production HTML files; this doctrine records the requirement only.

---

## §9 — sitemap.xml

Static XML, regenerated only when canonical URL set changes.

> ⚠️ **V1.1 Deferral notice for `?lang=vi` sitemap hreflang entries:** the `xhtml:link rel="alternate" hreflang="vi-VN" href="…?lang=vi"` lines in the example below are **deferred — do not ship this in production until Vietnamese URLs render localized initial HTML and are crawlable.** They conflict with `Disallow: /*?lang=` in §8 and with SEO-II. Authoritative rule: §7.3. The example is preserved for historical V1.0 context only; the V1.1 production sitemap must omit `vi-VN` alternates until path-based `/vi/*` locales exist.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <url>
    <loc>https://kahuola.org/</loc>
    <lastmod>2026-05-13</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://kahuola.org/"/>
    <!-- DEFERRED in V1.1 — see §7.3. Do not ship until /vi/* path-based locale exists. -->
    <xhtml:link rel="alternate" hreflang="vi-VN" href="https://kahuola.org/?lang=vi"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://kahuola.org/"/>
  </url>

  <url>
    <loc>https://kahuola.org/live-map</loc>
    <lastmod>2026-05-13</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://kahuola.org/live-map"/>
    <!-- DEFERRED in V1.1 — see §7.3. Do not ship until /vi/* path-based locale exists. -->
    <xhtml:link rel="alternate" hreflang="vi-VN" href="https://kahuola.org/live-map?lang=vi"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://kahuola.org/live-map"/>
  </url>

  <url>
    <loc>https://kahuola.org/storm</loc>
    <lastmod>2026-05-13</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>https://kahuola.org/privacy</loc>
    <lastmod>2026-05-13</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>

  <url>
    <loc>https://kahuola.org/support</loc>
    <lastmod>2026-05-13</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>

</urlset>
```

**`<changefreq>` honesty rule (SEO-III):** `hourly` reflects the snapshot refresh cadence on `/live-map` and `/storm`. It does not promise visible page-content changes every hour. If snapshot cadence slows, `<changefreq>` must change with it.

---

## §10 — Core Web Vitals Targets

Civic platforms must perform on degraded networks (3G mobile, hot phones, slow CPUs).

| Metric | Target | Hard limit |
|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.0s | ≤ 2.5s |
| INP (Interaction to Next Paint) | ≤ 150ms | ≤ 200ms |
| CLS (Cumulative Layout Shift) | ≤ 0.05 | ≤ 0.10 |
| TTFB (Time to First Byte) | ≤ 300ms | ≤ 600ms |
| TBT (Total Blocking Time) | ≤ 150ms | ≤ 300ms |

**Why this matters for SEO:** Google's Page Experience signal uses CWV. More importantly, a Lahaina resident on a degraded cell network during an evacuation cannot wait 4 seconds for a map to load.

### 10.1 Required performance practices

- Hero text and meta description in initial HTML — no JS dependency for crawlable content
- Map library (MapLibre GL JS / Leaflet) lazy-loaded after first paint
- All third-party scripts deferred or async
- Critical CSS inlined; rest loaded with `media="print" onload`
- Images: `loading="lazy"`, `decoding="async"`, explicit `width`/`height` (prevents CLS)
- Preconnect to `https://media.kahuola.org` and Cloudflare Worker origin
- `font-display: swap` on any custom fonts

### 10.2 Mobile throttled validation (V1.1)

- SEO deploy validation **must include throttled mobile testing**.
- **Test profile:** slow/degraded mobile connection (e.g., Slow 3G or worse), low-end CPU simulation (e.g., 4–6× CPU throttle), measured on both **first load** and **repeat load** (warm cache).
- **Desktop Lighthouse alone is insufficient** for Kahu Ola. A green desktop score is not a pass.
- **Passing performance means the page remains understandable before map JS fully initializes** — `<h1>`, lead paragraph, civic disclaimer, official-source footer link, and snapshot-freshness placeholder must all be visible and readable.
- The test reflects the **Lahaina / hot-phone / 3G scenario from §1**. If the page fails this scenario, no SEO change ships, regardless of how good the desktop numbers look.

---

## §11 — Page-Specific SEO Content Blocks

### 11.1 `/` (homepage)

Required above-the-fold static content (crawlable):

```html
<header>
  <h1>Hawaiʻi Hazard Awareness — Live Civic Map</h1>
  <p class="lead">
    Independent civic hazard intelligence for Maui, Hawaiʻi Island, Oʻahu, Kauaʻi, Molokaʻi, and Lānaʻi.
    Wildfire hotspots, flood context, air quality, and fire weather — drawn from publicly available
    government data sources.
  </p>
  <p class="civic-disclaimer">
    Kahu Ola is not an official emergency service. For evacuation orders and emergency directives,
    follow <a href="https://dod.hawaii.gov/hiema/" rel="noopener">Hawaiʻi Emergency Management Agency</a>
    and your county emergency management office.
  </p>
</header>
```

**Why this exists:** crawlers and screen readers both need a clear, plain-language `<h1>` and lead paragraph. Map widgets and JS-rendered signals do not satisfy this requirement.

### 11.2 `/live-map`

```html
<header>
  <h1>Live Hawaiʻi Hazard Map</h1>
  <p class="lead">
    Real-time wildfire detections, flash flood alerts, air quality, fire weather, and storm context
    across the Hawaiian Islands. Data is aggregated from NASA FIRMS, NOAA, NWS, EPA AirNow, and
    PacIOOS through the Kahu Ola Aggregator.
  </p>
  <p class="freshness">
    Snapshot freshness: <span data-snapshot-freshness>Loading…</span>
  </p>
</header>
```

The `<span data-snapshot-freshness>` is the only JS-hydrated content above the fold and degrades gracefully to "Loading…" — never blank, never misleading.

### 11.3 `/storm`

```html
<header>
  <h1>Active Storm Conditions — Hawaiʻi</h1>
  <p class="lead">
    Current storm tracking with post-storm wildfire risk context for Maui, Hawaiʻi Island, and the
    rest of the Hawaiian Islands. Drawn from NWS, NOAA, and NHC sources.
  </p>
</header>
```

---

## §12 — Local SEO

Kahu Ola is geographically scoped to Hawaiʻi. Local signals matter.

### 12.1 Geographic targeting signals

```html
<meta name="geo.region" content="US-HI">
<meta name="geo.placename" content="Hawaiʻi">
<meta name="geo.position" content="20.7984;-156.3319">
<meta name="ICBM" content="20.7984, -156.3319">
```

Coordinates point to central Maui (Kahului area) — the operational center of the Maui-first doctrine.

### 12.2 Local link-building targets (outbound, not requesting backlinks)

Footer links every page should carry:

- `https://dod.hawaii.gov/hiema/` (HIEMA)
- `https://www.weather.gov/hfo/` (NWS Honolulu)
- `https://www.mauicounty.gov/238/Maui-Emergency-Management-Agency`
- `https://www.hawaiicounty.gov/departments/civil-defense`
- `https://www.honolulu.gov/dem`
- `https://www.kauai.gov/Government/Departments-Agencies/Emergency-Management-Agency`

### 12.3 NOT applicable

- Google Business Profile: Kahu Ola has no physical location to verify
- Local citations / NAP consistency: civic platform, not a business
- Review schema: civic platforms must not solicit user reviews of hazard data

---

## §13 — Content Strategy

The project's actual SEO content engine is the automated morning brief, **not** keyword-stuffed articles.

### 13.1 What we publish

- **Morning briefs** → automated to Facebook, Telegram, YouTube (existing pipeline)
- **Live map page** → already a high-intent landing surface
- **Storm event pages** → published only when an active event warrants it (no SEO-bait event pages)

### 13.2 What we do NOT publish

- ❌ "Top 10 Hawaiʻi Wildfire Tips" listicles
- ❌ Repurposed government press releases
- ❌ AI-generated emergency preparedness content
- ❌ Anything that competes with HIEMA or county EMA for informational queries
- ❌ Sensationalized headlines around past disasters (Lahaina 2023, etc.)

### 13.3 Backlink strategy

**Earned, not pursued.** Kahu Ola earns backlinks through:

1. Being genuinely useful during active hazard events
2. Local news mentions during emergencies (organic, not pitched)
3. Civic technology and open-data community references
4. University and emergency-management research citations

**Forbidden tactics:**
- Paid link placements
- Reciprocal link exchanges
- Comment spam on news sites
- Guest posts written purely for backlinks
- Private blog networks (PBNs)

---

## §14 — Crawler Behavior & Indexing

### 14.1 Cloudflare caching impact

`/live-map` has a 4-hour Cloudflare cache TTL (per existing operational notes). For SEO this means:

- Googlebot fetches the cached HTML, not a fresh render
- The `<span data-snapshot-freshness>` placeholder will be in the cached HTML — this is fine; it is not misleading because it explicitly says "Loading…"
- After deploy, **Purge Everything** in Cloudflare before requesting reindex in Search Console

### 14.2 Search Console verification

Register both:
- `kahuola.org` (domain property — preferred)
- `https://kahuola.org` (URL-prefix property — fallback)

Verification method: DNS TXT record (most resilient against deploy changes).

### 14.3 Submission checklist (post-deploy)

After any change to canonical URL set, sitemap, or robots.txt:

1. Cloudflare → Caching → Purge Everything
2. Google Search Console → Sitemaps → Submit `https://kahuola.org/sitemap.xml`
3. Search Console → URL Inspection → Request indexing for changed pages
4. Bing Webmaster Tools → submit same sitemap
5. Verify in 48–72h: `site:kahuola.org` returns canonical URLs

---

## §15 — Monitoring & KPIs

Civic SEO success is not measured in traffic alone.

### 15.1 Primary KPIs

| KPI | Target | Why it matters |
|---|---|---|
| Top-3 ranking on `maui wildfire map` | Within 90 days post-launch | Disaster discoverability |
| Top-5 ranking on `hawaii hazard map` | Within 90 days | Statewide entry point |
| LCP p75 (mobile) | < 2.5s | Degraded-network usability |
| Crawl errors (Search Console) | 0 | Indexability integrity |
| Pages indexed | = pages in sitemap | No phantom or missing URLs |
| Schema.org errors | 0 | Trust signals intact |

### 15.2 Secondary KPIs

- Outbound clicks to HIEMA / county EMA / NWS (proves routing-to-authority is working)
- Organic traffic spike correlation with active hazard events (proves disaster-time relevance)
- Mobile share of organic traffic (target ≥70% — disaster-time users are on phones)

### 15.3 Forbidden metrics

- ❌ Bounce rate as a primary KPI (high bounce during a wildfire is **good** — users got the signal and acted)
- ❌ Session duration (longer is not better in a hazard context)
- ❌ Conversion rate (Kahu Ola has no conversions; pursuing them creates wrong incentives)

### 15.4 Search Console query buckets (V1.1)

Search Console monitoring **must separate** queries into three buckets. Mixing them obscures whether the civic-authority boundary (SEO-I) is holding.

**1. Branded queries** — Kahu Ola itself:

- `kahu ola`
- `kahuola`
- `kahu ola app`

**2. Disaster-time discovery queries** — hazard-specific, geographic, in-scope per §2.1:

- `maui wildfire map`
- `hawaii hazard map`
- `hawaii air quality today`
- `hawaii fire weather red flag`

**3. Authority-routing queries** — official-directive-shaped queries that Kahu Ola may inadvertently appear under:

- `maui evacuation map`
- `hawaii emergency alert`
- `maui fire official update`

> **Important:** Authority-routing queries are **not competition targets**. They are **monitored** to confirm that when Kahu Ola appears under such a query, the landing page routes users toward HIEMA, county EMA, NWS, and other official authorities — and does not impersonate them. If Kahu Ola starts ranking *competitively* on authority-routing queries against the real authority, that is a signal to **review wording, schema, and titles for boundary drift** (SEO-I), not to celebrate.

---

## §16 — Compliance Checks (pre-deploy)

Before any change touching SEO surfaces, verify:

- [ ] No `<title>` claims official authority
- [ ] No meta description impersonates an agency
- [ ] No JSON-LD uses `GovernmentOrganization`, `EmergencyService`, or `NewsArticle`
- [ ] No OG image contains an agency logo
- [ ] Civic disclaimer present in footer of every page
- [ ] At least one official-source link in footer of every page
- [ ] Canonical URL set matches sitemap exactly
- [ ] hreflang declarations point to existing URLs
- [ ] robots.txt blocks `/api/*`
- [ ] No JS-dependent content carries irreplaceable SEO signal
- [ ] All freshness language honest (no "live" claim where snapshot age > FRESH threshold)

**V1.1 additions:**

- [ ] No `?lang=` hreflang is advertised unless the alternate page renders localized content in initial HTML and is crawlable (§7.3)
- [ ] `/api/*` responses emit `X-Robots-Tag: noindex, nofollow, nosnippet` where practical (§8.1)
- [ ] Final shipped titles pass the 50–60 character target, with civic-clarity tolerance up to 65 characters (§4.2)
- [ ] Structured data is used for entity clarity, not rich-result growth tactics (§5.6)
- [ ] Mobile throttled validation completed before SEO deploy — desktop Lighthouse alone is not a pass (§10.2)
- [ ] Search Console monitoring separates branded, disaster-time discovery, and authority-routing query buckets (§15.4)

---

## §17 — Production File Lock & Implementation Path

Production HTML files (`index.html`, `live-map.html`, `privacy.html`, `support.html`) are locked. SEO changes to these files are **explicit-instruction only** and proceed through the V4.7 staging workflow:

1. SEO snippets land first in this doctrine document (canonical reference)
2. Code review by the architect confirms each snippet against §16 checklist
3. Snippets are applied to staging copies in `~/Documents/kahuola-web` working tree
4. Multi-browser smoke test (Chrome, Safari iOS, Firefox) — same gate as live-map.html CSS changes
5. `git commit` with SEO-specific commit message: `seo(metadata): add JSON-LD WebApplication to live-map`
6. Cloudflare Purge Everything
7. Search Console reindex request
8. Update `WORK_LOG.md` with deploy timestamp (HST)

No SEO change ships without this flow. The doctrine is the contract; the HTML is the deliverable.

---

## §18 — Future Phases

**V1 (current scope):** Metadata, structured data, sitemap, robots, hreflang for the 5 canonical pages.

**V2 (out of scope, scoped here for record):**
- Island-specific landing pages (`/maui`, `/hawaii-island`, `/oahu`, etc.) if and only if they offer non-redundant content beyond the live map
- Path-based locales (`/vi/live-map`) replacing query-parameter Vietnamese
- Server-side rendered snapshot freshness via Cloudflare Worker HTML rewriting (not currently warranted)
- Image search optimization for hazard imagery (low priority; civic platform should not optimize for sensational image queries)

**V3 (research only):**
- News indexing inclusion via Google News Publisher Center — **likely refused** because Kahu Ola is not a publisher in the editorial sense, but worth documenting the decision
- PWA installability signals for richer mobile presentation

---

## V1.1 Amendment Summary — Technical SEO Clarifications

This section consolidates the V1.1 patch. Each item is a clarification, not a rewrite — original V1.0 content is preserved.

- **Vietnamese hreflang deferred** (§7.3, authoritative): `?lang=vi` hreflang URLs are not advertised in production until server-rendered or path-based localized pages (e.g., `/vi/live-map`) exist. The §7.1 hreflang example and the §9 sitemap `vi-VN` alternates are marked "DEFERRED in V1.1" and preserved for historical context only. The on-page EN/VI UI switcher and `i18n/kahuola-i18n.js` are unaffected.
- **API noindex header rule** (§8.1): `/api/*` remains blocked from crawl in `robots.txt` and should additionally emit `X-Robots-Tag: noindex, nofollow, nosnippet` where practical. Complementary, not redundant.
- **Title length tolerance** (§4.2): 50–60 character target stands; civic-clarity tolerance up to 65 characters is allowed when hazard scope would otherwise become unclear.
- **Structured data expectation** (§5.6): schema is for entity clarity and civic posture, not rich-result growth. Forbidden schema types (§5.5) remain forbidden.
- **Search Console query buckets** (§15.4): monitoring must separate branded, disaster-time discovery, and authority-routing queries. Authority-routing queries are monitored to confirm SEO-I boundary integrity — never targeted competitively.
- **Mobile throttled validation** (§10.2): SEO deploy validation must include throttled mobile testing (slow connection, low-end CPU, first + repeat load). Desktop Lighthouse alone is not a pass.

**What V1.1 does NOT change:**
- SEO-I Civic authority boundary, SEO-II Render under failure, SEO-III Honest freshness — all preserved.
- §17 production file lock — `index.html`, `live-map.html`, `privacy.html`, `support.html` remain locked behind the V4.7 staging workflow.
- §1 SEO philosophy — disaster-time discoverability, not marketing growth.
- The forbidden schema list, forbidden query targeting list, and forbidden content tactics — all preserved.
- The existing EN/VI i18n architecture and client-side language switching.

**Remaining next step:** Architect review of the §16 checklist (including V1.1 additions) before any production HTML SEO implementation under the §17 staging workflow.

---

## Footer — Doctrine Conformance

✅ Architecture invariants respected — SEO doctrine flows from the 5 system invariants
✅ No upstream API called from client — `/api/*` blocked in robots.txt
✅ No PII exposure — no user identifiers in URLs, no analytics tracking specs in this doctrine
✅ No `print()` / `console.log()` in production code — doctrine is markdown only, no executable code shipped

— Kahu Ola SEO Doctrine V1.1
