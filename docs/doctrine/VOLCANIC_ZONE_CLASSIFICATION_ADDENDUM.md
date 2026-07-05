# Volcanic Zone Classification — Doctrine Addendum

_Status: active · Added 2026-07-05 · Companion to `SYSTEM_INVARIANTS.md`._

## Problem
NASA **FIRMS** is a **thermal-anomaly** detector, not a wildfire classifier. On
Hawaiʻi Island, lava and volcanic vent heat at Kīlauea / Mauna Loa produce real
thermal detections. Labelling those as "wildfire" mislabels the hazard and fired
the Kūpuna **fire** advisory when the correct hazard was volcanic smog (vog) /
air quality.

## Doctrine: "Layer A owns truth, Layer B owns words"

**Layer A (worker) — truth.** Each FIRMS detection is tagged with a
`volcanic_zone: true|false` property by a **pure geometry test** (`inVolcanicZone`)
against static `VOLCANIC_ZONES` bboxes sourced from public **USGS HVO** references.
This is a coordinate-in-bbox check on **already-validated** coordinates — it is
**not inference** and never invents data (Invariant III safe). Bboxes are
deliberately **generous**: it is safer to tag a near-volcano detection as
volcanic-zone than to let vent heat trigger an urban wildfire advisory.

- Zones (as of 2026-07-05): `kilauea-summit-erz` `[-155.35,-154.80]×[19.25,19.50]`;
  `mauna-loa` `[-155.75,-155.40]×[19.30,19.60]`. They exclude Hilo (19.72°N),
  Maui, and Oʻahu, so genuine wildfires there are **not** mislabelled.
- Summary endpoint reports `fire.{count, volcanic_zone_count, wildland_count}`
  with the invariant `count === volcanic_zone_count + wildland_count`.

**Layer B (client) — words.** The client never re-derives the classification; it
only chooses wording/advisory from Layer A's counts + per-feature flag.

- Label: "Wildfire" → **"Satellite Heat Signals"**; when `volcanic_zone_count > 0`
  a breakdown is shown (N in volcanic zone / N outside).
- Live-map FIRMS popup adds a volcanic-zone line when `volcanic_zone: true`.

## Advisory switching (ONE shared decision — fail-closed to safety)

The decision lives in a **single** client function, `classifyHeatSignals(volcanic,
wildland)`, used by **both** the hero and the Kūpuna advisory so the two surfaces
can never diverge (no duplicated if/else). Red Flag is handled by each caller
(always → FIRE).

| Condition | Result |
|---|---|
| `wildland ≥ 1` | **FIRE** — keep the fire advisory unchanged (never relax safety). |
| `wildland == 0 && volcanic > 0` (and no NWS Red Flag) | **VOG** — volcanic air-quality advisory: vog + ash, respiratory/elderly guidance, "turn on the Air Quality layer", USGS HVO link, calm tone, "E mālama pono." |
| anything else (missing field / old cache / degraded / error / Red Flag) | **FIRE** — fall back to the safer default. |

Two data sources, consistent decision:
- **Card** reads `/api/hazards/summary` → uses server `volcanic_zone_count` /
  `wildland_count` (missing/non-number → `wildland = count`).
- **Hero + Kūpuna** read raw `/api/firms/hotspots` → derive the split client-side
  from per-feature `properties.volcanic_zone === true` (strict boolean; a missing
  field counts as wildland). The two surfaces may differ by seconds (independent
  caches) but the **decision logic is identical**.

The switch changes the advisory to the **correct** hazard — it never turns one off.

## Hero: wording only (state machine unchanged)
When every heat signal is volcanic, the hero **text** changes within the existing
`FIRE_ACTIVE` state — label becomes "heat signals … Kīlauea/Mauna Loa volcanic
zone", the kicker reads as volcanic (not "fire active"). Colour/state are
unchanged.

## Out of scope (backlog)
The hero **state machine / Event Priority** (`FIRE_ACTIVE` still *triggers* when
every detection is volcanic) is a larger question and is intentionally **not**
changed here — only the wording within the current state is corrected.
