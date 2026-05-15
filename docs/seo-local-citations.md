# Kahu Ola — Local SEO Citations & Directory Submissions

**Last updated:** 2026-05-15
**Phase:** C.5 (Local SEO infrastructure)
**Status:** Reference document — submissions are manual, executed by operator

This document is a deliverable, not a deployment. It contains everything needed
to create consistent directory listings and Google Business Profile entries
for Kahu Ola. NAP consistency across every external listing is critical for
local SEO ranking — this file is the canonical source.

---

## Section 1 — Canonical NAP Reference

Use these exact values on every external directory submission. Do not deviate.

```
Name:           Kahu Ola
Alternate name: Kahu Ola — Hawaiʻi Civic Hazard Intelligence
Tagline:        Guardian of Life
Location:       Waikoloa, Hawaiʻi, USA
Address:        (no street address — solo civic technology project,
                 service-area-only listing)
Service area:   Hawaiʻi (statewide); Maui-first focus; expansion to all
                Hawaiian islands and US Pacific territories planned
Phone:          (none — email-only contact, standard for solo civic tech)
Email:          long@kahuola.org
Website:        https://kahuola.org
Founded:        2026-03-04
Founder:        Long Nguyen, Founder & Architect
Categories:     Civic Technology, Emergency Information Service,
                Public Safety Information Platform, Software Company
Schema type:    Organization (with Person founder, AboutPage, WebApplication)
```

When a directory asks for NAICS or industry codes, use:
- **NAICS 519130** — Internet Publishing and Broadcasting and Web Search Portals
- **NAICS 541512** — Computer Systems Design Services (secondary)

---

## Section 2 — Google Business Profile Setup Checklist

Google Business Profile is the single highest-impact local SEO entry. Execute first.

```
1.  Visit https://business.google.com
2.  Click "Add your business to Google"
3.  Business name: "Kahu Ola"
4.  Primary category: "Software Company"
    Secondary category: "Public Safety Office"
5.  Location type: choose "I serve customers at their locations"
    (this makes it a service-area business — no storefront required)
6.  Service area: select "Hawaii" (full state). Optionally add specific
    cities: Waikoloa, Lahaina, Kahului, Hilo, Honolulu, Lihue.
7.  Contact details:
    - Phone: leave blank (email-only)
    - Website: https://kahuola.org
8.  Hours: 24/7 (online platform, always reachable)
9.  Description (use the 750-char version from
    docs/seo-google-business-description-shorter.md)
10. Photos: upload PNG export of /assets/brand/logo-mark.svg
    (export at 720×720 from the SVG; cropped square)
11. Verification: Google requires verification for service-area businesses.
    Options: postcard mail, phone call, video verification, email.
    For solo operator: video verification is fastest (~3-5 business days).

After verification:
12. Add a "Service" listing for each: "Hazard Map", "Wildfire Awareness",
    "Flood Alerts", "Air Quality Monitoring", "Storm Tracking"
13. Enable "Messages" feature so residents can DM directly
14. Post a launch update (one per quarter is sustainable)
```

Expected ranking impact: appears in Google Maps "near me" searches for
"Hawaii hazard map", "Maui wildfire alerts", "Hawaii civic tech" within
1-2 weeks of verification.

---

## Section 3 — Description Text (copy-paste ready)

Different directories have different character limits. Pre-written variants
are in `docs/seo-google-business-description-shorter.md`.

### Full description (≤750 chars — Google Business Profile, full directory listings)

> Kahu Ola ("Guardian of Life") is an independent civic technology
> platform serving Hawaiʻi communities with real-time hazard awareness.
> We aggregate publicly available government data from NASA FIRMS, NOAA,
> NWS, EPA AirNow, and PacIOOS into a single, accessible interface
> showing wildfires, flash floods, air quality, fire weather, tsunamis,
> and storms.
>
> Built in response to the 2023 Maui wildfires, Kahu Ola is wildfire-first,
> privacy-first (zero personal data collected), and failure-tolerant. We
> serve Hawaiʻi residents free, with no advertising, and operate
> independently of government and commercial interests.
>
> Kahu Ola does not replace official emergency services or issue
> evacuation orders. For official guidance, always contact HIEMA, county
> emergency management, or the National Weather Service. Visit
> kahuola.org for live hazard maps and situational awareness.

---

## Section 4 — Target Directories (priority order)

### Tier 1 — Submit immediately (high authority)

| # | Directory | URL | Time | Priority | Notes |
|---|---|---|---|---|---|
| 1 | Google Business Profile | business.google.com | 30 min + verification | **P0** | Direct ranking impact |
| 2 | Bing Places for Business | bingplaces.com | 15 min | P1 | Bing/DuckDuckGo coverage |
| 3 | Apple Business Connect | businessconnect.apple.com | 20 min | P1 | Apple Maps + Siri |
| 4 | Schema.org Validator | validator.schema.org | 5 min | P1 | Re-validate /about |

### Tier 2 — Civic / open government directories

| # | Directory | URL | Notes |
|---|---|---|---|
| 5 | Code for America Brigade Network | brigade.codeforamerica.org/brigades | Civic tech project listing |
| 6 | GovTech Solutions | govtech.com | Featured civic tech submission |
| 7 | Open Government Partnership | opengovpartnership.org | Independent civic platform |

### Tier 3 — Hawaiʻi-specific directories

| # | Directory | URL | Notes |
|---|---|---|---|
| 8 | State of Hawaiʻi Business Registration | hbe.ehawaii.gov | Optional — only if registered as DBA |
| 9 | Hawaiʻi Business Magazine directory | hawaiibusiness.com | Local credibility |
| 10 | Maui Chamber of Commerce | mauichamber.com | Membership required for full listing |

### Tier 4 — Civic tech press / community

| # | Directory | URL | Notes |
|---|---|---|---|
| 11 | CivicTech Field Guide | civictech.guide | Submission-based, very high accept rate |
| 12 | Public Interest Tech Network | publicinterest.tech | Independent civic platform welcome |

---

## Section 5 — NAP Consistency Audit

Run this script periodically to verify NAP consistency across submissions.

```bash
#!/bin/bash
# NAP audit reference — copy values to verify against directory listings
echo "Kahu Ola canonical NAP (verify these match every directory entry):"
echo ""
echo "  Name:     Kahu Ola"
echo "  Email:    long@kahuola.org"
echo "  Location: Waikoloa, Hawaiʻi, USA"
echo "  Website:  https://kahuola.org"
echo "  Founded:  2026-03-04"
echo "  Tagline:  Guardian of Life"
echo "  Service:  Hawaiʻi (statewide), Maui-first"
```

Save your tracking spreadsheet (Google Sheets / Notion / Airtable) with columns:

| Directory | Submitted | Verified | Listing URL | NAP matches canonical? | Notes |
|---|---|---|---|---|---|

Re-audit quarterly. NAP inconsistency is one of the top-3 local SEO problems.

---

## Section 6 — Post-Submission Verification

After each submission, verify:

1. The listing is publicly visible (search the directory for "Kahu Ola")
2. NAP matches the canonical reference exactly (especially the ʻokina in "Hawaiʻi")
3. The website link goes to https://kahuola.org (not http://, not www.)
4. The category matches one of the documented categories above
5. The description doesn't contain forbidden terms ("Official", "Government",
   "Emergency Service" outside the standard disclaimer phrasing) — see
   doctrine §11.2 forbidden-words list
