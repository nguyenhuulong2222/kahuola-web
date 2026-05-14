# Kahu Ola — SEO Implementation Checklist

**Document ID:** KAHUOLA-SEO-IMPL-V1.1
**Source doctrine:** [`KAHU_OLA_V4_SEO_DOCTRINE.md`](./KAHU_OLA_V4_SEO_DOCTRINE.md) (V1.1)
**Aligns with:** Kahu Ola V4.3.1 Doctrine · V4.7 Doctrine · V4.8 Master Index
**Classification:** Civic Hazard Intelligence — Discoverability Layer (Implementation Track)
**Last updated:** 2026-05-13
**Architect:** Long Nguyen

---

## 1. Purpose

This checklist converts **Kahu Ola SEO Doctrine V1.1** into a **safe, phased implementation workflow**.

The doctrine is the contract. This checklist is the operational path from "doctrine on disk" to "SEO live in production" — without breaking the three SEO invariants:

- **SEO-I** — Civic authority boundary (no impersonation, no directive authority claims)
- **SEO-II** — Render under failure (initial-HTML metadata, no JS dependency for SEO signal)
- **SEO-III** — Honest freshness (no false "live" or "current" claims)

This document does **not** ship SEO snippets. It does not modify production HTML. It exists so that when the architect approves an implementation phase, the work proceeds in a known order with a known set of safety gates.

If this checklist and the doctrine conflict, **the doctrine wins**, and this checklist must be updated.

---

## 2. Hard locks

The following production files are **locked**. They cannot be edited unless the architect explicitly approves an implementation phase that names the file(s) being changed:

- `index.html`
- `live-map.html`
- `privacy.html`
- `support.html`

Additional locks for this checklist's scope (not edited by SEO work):

- `i18n/kahuola-i18n.js` — Phase 1 client-side EN/VI switching, unaffected by SEO doctrine
- `KAHU_OLA_V4_SEO_DOCTRINE.md` — doctrine is amended through a separate versioned doctrine patch, not through implementation work

**Lock release procedure:** the architect names the specific SEO phase (e.g., "SEO-C metadata staging for `/live-map`"), confirms the §16 doctrine compliance checklist is reviewed, and authorizes the staging diff. No "while I'm in there" edits.

---

## 3. SEO implementation phases

Each phase is independently gated. A later phase may not begin until the preceding phase is reviewed and approved by the architect. Skipping ahead is not permitted, even when "the snippet is ready."

### Phase SEO-A — Documentation readiness

Pre-conditions for any production SEO work to be considered at all.

- [ ] **Doctrine V1.1 committed** to the repo (`KAHU_OLA_V4_SEO_DOCTRINE.md`, Document ID `KAHUOLA-SEO-V1.1`)
- [ ] **This implementation checklist committed** to the repo (`KAHUOLA_SEO_IMPLEMENTATION_CHECKLIST.md`)
- [ ] **§16 compliance checklist reviewed** by the architect, including the V1.1 additions:
  - hreflang `?lang=` deferral (§7.3)
  - `/api/*` `X-Robots-Tag` plan (§8.1)
  - Title-length tolerance up to 65 chars for civic clarity (§4.2)
  - Structured data is entity clarity, not rich-result growth (§5.6)
  - Mobile throttled validation required (§10.2)
  - Search Console query buckets separated (§15.4)
- [ ] **V1.1 Amendment Summary** in the doctrine read and acknowledged

**Gate to leave SEO-A:** architect sign-off that documentation is the authoritative reference for all subsequent phases.

### Phase SEO-B — robots.txt and sitemap.xml

Crawl-control and indexability primitives. No production HTML edits.

**robots.txt (planning only — file not created yet):**

- [ ] Verify `Disallow: /api/*` rule is part of the plan (Invariant I downstream effect; §8)
- [ ] Verify `?lang=` handling **follows V1.1 hreflang deferral**: `Disallow: /*?lang=` remains, and no `?lang=vi` hreflang is advertised in production (§7.3, §8)
- [ ] Add **`X-Robots-Tag: noindex, nofollow, nosnippet`** plan for Worker API responses where practical (§8.1). This is a Worker-side implementation; it does not modify production HTML files
- [ ] Confirm `Sitemap:` line points to the canonical sitemap URL
- [ ] No `Crawl-delay` (Cloudflare CDN handles rate concerns)

**sitemap.xml (planning only — file not created yet):**

- [ ] Confirm sitemap canonical URL set: `/`, `/live-map`, `/storm`, `/privacy`, `/support` — and **only** these (matches §3.1)
- [ ] Confirm sitemap **omits `vi-VN` `?lang=vi` alternates** until path-based `/vi/*` locales exist (§7.3)
- [ ] Confirm `<changefreq>` values honest under SEO-III (snapshot cadence, not page-deploy time)
- [ ] Confirm `<lastmod>` will be regenerated only when the canonical URL set changes

**Gate to leave SEO-B:** architect sign-off on the planned `robots.txt`, `sitemap.xml`, and Worker `X-Robots-Tag` behavior. Files are still not created in production at this point.

### Phase SEO-C — Metadata staging

Title, meta description, and canonical snippet drafting. **Staging-area work in `~/Documents/kahuola-web` per §17 V4.7 workflow — production HTML still untouched.**

- [ ] Draft `<title>` for each canonical page using the approved title set in §4.2
- [ ] Draft `<meta name="description">` for each canonical page using the approved description set in §4.3
- [ ] Draft `<link rel="canonical">` — clean, unparameterized English URL, no trailing slash, lowercase
- [ ] Draft `<link rel="alternate" hreflang="en-US">` and `hreflang="x-default">` — **no `vi-VN` hreflang** in V1.1 output (§7.3)
- [ ] Draft Open Graph + Twitter Card metadata per §6
- [ ] Draft geo / ICBM meta per §12.1

**Content compliance checks:**

- [ ] No title or description contains: `Official`, `Government`, `Emergency Service`, `Breaking`, `Urgent`, `🔥`, exclamation marks, or other clickbait
- [ ] No agency impersonation: no NASA, NOAA, NWS, EPA, USGS, NIFC, HIEMA, or county EMA endorsement language
- [ ] Title length within target **50–60 characters**, with **civic-clarity tolerance up to 65 characters** only when hazard scope would otherwise be unclear (§4.2)
- [ ] Description length 140–155 characters, includes civic disclaimer fragment (§4.3)
- [ ] Brand suffix `| Hawaiʻi Hazard Awareness` uses ʻokina, not apostrophe

**Gate to leave SEO-C:** architect reviews the staged metadata diff and signs off against §16 compliance checklist.

### Phase SEO-D — Structured data staging

JSON-LD blocks for each canonical page. Still staging only.

**Allowed schema types (per §5.1–§5.4):**

- [ ] `Organization` (site-wide; every page)
- [ ] `WebSite` (homepage only)
- [ ] `WebApplication` (live-map only)
- [ ] `BreadcrumbList` (live-map, storm)

**Explicitly forbidden schema types (per §5.5) — must not appear anywhere in JSON-LD output:**

- [ ] `GovernmentOrganization` — **forbidden**
- [ ] `EmergencyService` — **forbidden**
- [ ] `NewsArticle` — **forbidden**
- [ ] `NewsMediaOrganization` — **forbidden**
- [ ] `MedicalWebPage` — **forbidden**

**Posture compliance (§5.6):**

- [ ] `description` and `disambiguatingDescription` make Kahu Ola's civic, non-authoritative posture explicit
- [ ] Structured data is justified as **entity clarity**, not rich-result growth
- [ ] If a schema choice would help a rich result but blur SEO-I, the boundary wins

**Validation:**

- [ ] Pasted into Google's Rich Results Test / Schema Markup Validator — zero errors, zero warnings on the civic-boundary fields
- [ ] No conflicts with the Organization `@id` across pages (single canonical org node)

**Gate to leave SEO-D:** architect reviews JSON-LD blocks against the forbidden list and §5.6 posture rule.

### Phase SEO-E — Page content staging

Above-the-fold static content drafts per §11. Still staging only.

- [ ] **Homepage** (`/`): `<h1>` + lead paragraph + civic disclaimer paragraph in initial HTML (§11.1)
- [ ] **Live-map** (`/live-map`): static `<h1>` + lead paragraph + `<span data-snapshot-freshness>Loading…</span>` placeholder (§11.2). The placeholder is the **only** JS-hydrated above-the-fold content and degrades gracefully to "Loading…" — never blank, never misleading
- [ ] **Storm** (`/storm`): static `<h1>` + lead paragraph (§11.3)
- [ ] **Footer official-source routing links** on every page, pointing to HIEMA, NWS Honolulu, county EMAs (§12.2). At least one official-source link per page (§3.2)
- [ ] **No JS-dependent content** carries irreplaceable SEO signal. Hero text, civic disclaimer, official-source link, and meta description must all be in the initial HTML response (SEO-II)
- [ ] Civic disclaimer present in footer of every page (§16)

**Gate to leave SEO-E:** architect reviews the static-content diff for civic boundary clarity (no implied authority) and SEO-II compliance.

### Phase SEO-F — Performance validation

Mobile-first throttled testing before any production deploy (§10.2).

- [ ] **Throttled mobile test** run on staging copy:
  - [ ] Connection: Slow 3G (or worse)
  - [ ] CPU: 4–6× throttle (low-end CPU simulation)
  - [ ] Test **first load** (cold cache)
  - [ ] Test **repeat load** (warm cache)
- [ ] Page remains understandable **before map JS fully initializes**:
  - `<h1>` visible
  - Lead paragraph visible
  - Civic disclaimer visible
  - Official-source footer link visible
  - Snapshot-freshness placeholder visible (showing "Loading…", not blank)
- [ ] Core Web Vitals within §10 targets (LCP ≤ 2.5s hard limit, INP ≤ 200ms hard limit, CLS ≤ 0.10 hard limit, TTFB ≤ 600ms hard limit, TBT ≤ 300ms hard limit)
- [ ] **Desktop Lighthouse alone is not a pass.** If desktop passes but mobile-throttled fails, the change does not ship
- [ ] Test reflects the **Lahaina / hot-phone / 3G scenario from §1**

**Gate to leave SEO-F:** architect signs off on mobile-throttled results screenshots/logs attached to the implementation record.

### Phase SEO-G — Deploy workflow

Production HTML edit — the **only** phase that touches production files, and only after SEO-A through SEO-F are signed off.

Follows §17 V4.7 staging workflow exactly:

- [ ] **Multi-browser smoke test** on the staged copy: Chrome (desktop + mobile emulation), Safari iOS, Firefox — same gate as live-map.html CSS changes
- [ ] Apply staged snippets to the architect-approved production HTML file(s) — **only the files explicitly authorized for this phase**
- [ ] `git commit` with SEO-specific message, e.g. `seo(metadata): add JSON-LD WebApplication to live-map` (one logical change per commit)
- [ ] `git push` to the canonical remote
- [ ] **Cloudflare → Caching → Purge Everything**
- [ ] **Google Search Console → Sitemaps** → submit `https://kahuola.org/sitemap.xml`
- [ ] **Google Search Console → URL Inspection** → request indexing for the changed pages
- [ ] **Bing Webmaster Tools** → submit same sitemap
- [ ] **Update `WORK_LOG.md`** with deploy timestamp in **HST** and a one-line description of the SEO change
- [ ] 48–72h post-deploy: verify `site:kahuola.org` returns canonical URLs and no phantom `?lang=vi` URLs

**Gate to close SEO-G:** architect verifies WORK_LOG entry, Cloudflare purge, Search Console submission, and post-deploy `site:` check.

---

## 4. Pre-implementation STOP gate

> # 🛑 STOP
>
> **Do not edit production HTML until the architect approves the specific SEO implementation phase.**
>
> Production files locked under §17 of the doctrine:
> - `index.html`
> - `live-map.html`
> - `privacy.html`
> - `support.html`
>
> Approval must name:
> 1. The specific phase (SEO-A through SEO-G)
> 2. The specific file(s) being edited
> 3. The specific snippet(s) being applied
>
> "Approval to start SEO work" is **not** approval to edit production HTML. Each phase is gated independently. Phases SEO-A through SEO-F do **not** edit production HTML at all; only **SEO-G** does, and only after every preceding phase is signed off.
>
> If you find yourself about to edit `index.html`, `live-map.html`, `privacy.html`, or `support.html` without an explicit phase + file + snippet authorization in the conversation: **stop, write the proposed diff into the staging area only, and ask.**

---

## 5. Final checklist

A single-glance pre-deploy gate. **All boxes must be checked** before any SEO change is merged to production.

- [ ] **Production lock respected** — only the architect-named file(s) for the architect-named phase are being edited; no "while I'm in there" changes
- [ ] **No forbidden schema** — `GovernmentOrganization`, `EmergencyService`, `NewsArticle`, `NewsMediaOrganization`, `MedicalWebPage` do not appear anywhere in the shipped JSON-LD
- [ ] **No official authority claim** — no title, meta description, OG content, schema, or static content implies Kahu Ola is an official emergency service, government agency, or directive authority; no agency impersonation in copy or images
- [ ] **No `?lang=vi` hreflang shipped in V1.1** — production HTML and production sitemap advertise only `en-US` and `x-default` hreflang; client-side EN/VI UI switching remains untouched
- [ ] **`/api/*` noindex plan included** — Worker API responses emit `X-Robots-Tag: noindex, nofollow, nosnippet` where practical, in addition to `robots.txt` disallow
- [ ] **Mobile throttled validation planned and completed** — Slow 3G + low-end CPU, first load + repeat load; desktop Lighthouse alone is not accepted as a pass
- [ ] **Search Console query buckets planned** — monitoring separates branded / disaster-time discovery / authority-routing queries; authority-routing queries are monitored only, never targeted competitively

---

## Footer — Doctrine Conformance

✅ Doctrine V1.1 is the contract; this checklist is the implementation path
✅ Production HTML lock (§17) preserved
✅ V4.7 staging workflow preserved
✅ Three SEO invariants (SEO-I, SEO-II, SEO-III) preserved
✅ EN/VI i18n architecture preserved (client-side switching, no production hreflang for `?lang=vi`)
✅ No production HTML, doctrine, or i18n files modified by this document

— Kahu Ola SEO Implementation Checklist V1.1
