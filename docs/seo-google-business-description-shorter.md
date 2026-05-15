# Kahu Ola — Description Variants by Character Limit

**Use case:** Different directories have different `description` field length
limits. Pre-written variants below ensure NAP/messaging consistency without
ad-hoc rewriting (which causes local-SEO drift).

**Last updated:** 2026-05-15

---

## 160 chars (X bio, search snippet, micro-listings)

```
Kahu Ola — independent civic hazard intelligence for Hawaiʻi. Real-time wildfire, flood, storm data from NASA, NOAA, NWS. Free, no ads, no tracking.
```

(149 chars including ʻokina — fits comfortably under 160.)

---

## 250 chars (Twitter/X profile bio max, mid-size directory listings)

```
Kahu Ola ("Guardian of Life") aggregates real-time hazard data from NASA FIRMS, NOAA, NWS, EPA AirNow, PacIOOS into a single civic interface for Hawaiʻi. Wildfire-first, privacy-first, no advertising. Built after the 2023 Lahaina fires.
```

(241 chars. Tells the why and the what.)

---

## 500 chars (most directory descriptions, LinkedIn About summary)

```
Kahu Ola ("Guardian of Life") is an independent civic technology platform serving Hawaiʻi communities with real-time hazard awareness. We aggregate publicly available government data from NASA FIRMS, NOAA, NWS, EPA AirNow, USGS, and PacIOOS into a single, accessible interface showing wildfires, flash floods, air quality, fire weather, tsunamis, and storms.

Built in response to the 2023 Maui wildfires. Wildfire-first, privacy-first, free, no advertising, no tracking. Independent of government and commercial interests.
```

(497 chars.)

---

## 750 chars (Google Business Profile, full directory listings)

Use the version in `docs/seo-local-citations.md` Section 3.

---

## Notes on character counting

- ʻokina (U+02BB) = 1 codepoint, but 2 bytes in UTF-8
- Different platforms count differently. Some platforms count by visible
  characters (codepoints), others by bytes. Test before submitting.
- All variants above are codepoint-counted. If a platform rejects for "too
  long" but you're under the documented limit, the platform is byte-counting —
  shorten by the codepoint-vs-byte delta (typically 1-2 chars for our text
  with one ʻokina).
