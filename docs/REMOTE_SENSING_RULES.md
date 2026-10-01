# Kahu Ola — Remote Sensing & Process Rules

**Created:** 2026-10-01
**Owner:** Long Nguyen · kahuola.org
**Audience:** engineering, AI coding agents, grant reviewers
**Status:** Authoritative. A change that conflicts with a rule here gets redesigned,
not excepted.

Section A is about the data: what satellite products can and cannot support.
Section B is about how we work on it, learned the hard way on 2026-09-30/10-01
when a single line of copy ("These systems never stop") turned out to be the
same defect as a line of code.

---

## A. Remote-sensing rules

### A1 — Historical statistics use Standard/archive products of ONE Collection

Historical FIRMS statistics are computed from Standard (archive) products of a
**single Collection**, never from NRT, and never by summing NRT across time.

NRT and Standard are different products with different processing. NRT exists to
be fast; Standard exists to be comparable. Summing NRT over months produces a
number that cannot be reproduced, cannot be compared to anyone else's, and
silently inherits every reprocessing change along the way. Mixing Collections
(e.g. VIIRS C1 with C2) does the same thing across a version boundary.

If a statistic will ever appear next to the word "historical", it comes from
archive products of one Collection or it does not ship.

### A2 — Multi-year fire counts MUST be normalized for satellite count changes

The number of satellites observing Hawaiʻi has changed:

| from | satellite added |
|---|---|
2012 | Suomi NPP (VIIRS) |
2018 | NOAA-20 (VIIRS) |
2023 | NOAA-21 (VIIRS) |

More satellites means more passes means more detections of the same fire. A raw
year-over-year count therefore measures **our observing capacity**, not fire
activity, and a chart of it slopes upward whether or not anything changed on the
ground. Any multi-year count is normalized for the number of contributing
platforms, or it is not presented as a trend.

### A3 — Cross-region comparisons use density per km², never counts per lat/lon cell

A degree of longitude is not a constant distance. Counting detections per
lat/lon cell makes high-latitude regions look denser than they are and makes
Hawaiʻi comparable to nothing. Cross-region comparison is detections per km² of
land area, computed on an equal-area basis.

### A4 — "Revisit" is not "latency", and polar-orbit data is never "real-time"

Two different numbers, routinely conflated:

- **Revisit** — how often a satellite *looks* at Hawaiʻi. For a polar-orbiting
  VIIRS platform this is a small number of passes per day, not continuous.
- **Latency** — how long after a look the detection reaches us.

Between passes there is no observation to be late — there is nothing at all. So
an empty map is not evidence of no fire, and no copy anywhere may describe
polar-orbit fire detection as real-time, live, continuous, constant, or
"never stops". NEXRAD radar genuinely is near-continuous and may be described
that way; FIRMS may not.

Corollary: a zero detection count is always accompanied by the reason it may be
zero. A caveat that appears only sometimes teaches people to read its absence as
a guarantee.

### A5 — A FIRMS point is a pixel CENTER, not a fire location

Each detection marks the center of the pixel in which heat was detected. The
heat is somewhere inside that pixel. Precision is the pixel footprint, which
depends on scan angle: `scan` (across-track) × `track` (along-track), both
carried per-detection on `/api/firms/hotspots` as `scan_km` / `track_km` /
`footprint_km2` (RS-1).

At Hawaiʻi, measured live on 2026-09-30: **0.51 × 0.41 km**. At half a kilometre
that is several streets, which is why the map popup states the footprint rather
than implying a point. A missing dimension means **no precision claim** — never
a zero-area pixel, and never `Number(null)`.

### A6 — Data levels: Detection = L2, Context = L3, Estimate = L4

| level | meaning | example | may be styled as a detection? |
|---|---|---|---|
L2 | Detection — an instrument saw something | FIRMS hotspot | yes, it is one |
L3 | Context — gridded/composited observation | NEXRAD QPE, HMS smoke | no |
L4 | Estimate — model output | fire-danger heuristic, flood context | **never** |

An estimate is never styled or worded as a detection: not the same colour ramp,
not the same icon, not the same verbs. Invariant 5 (estimated never labeled
official) is the floor, not the ceiling — an L4 value also does not inherit an
L2 vocabulary.

### A7 — `summary.fire.count` is ALL heat, including volcanic

`/api/hazards/summary` emits `fire: { count, volcanic_zone_count, wildland_count }`
with the invariant `count === volcanic_zone_count + wildland_count`.

`count` is every thermal detection, Kīlauea included. Any surface whose label
says fire, wildfire or cháy reads **`wildland_count`**. A surface may show the
total only under a label that says *heat* (e.g. "Satellite Heat Signals").

This is not hypothetical: on 2026-09-30 the morning brief published
*"1 wildfire detections are present"* with `wildland_count: 0` — the one
detection was lava (RS-A1).

Volcanic classification is one predicate, `isVolcanicHeatFeature(f)`, shared by
every surface that splits heat. A second copy is how the invariant drifts apart.

### A8 — The two dedupe radii are intentional

| path | radius | why |
|---|---|---|
`/api/firms/hotspots` | ~11 m | collapses the same pixel reported twice; must NOT merge adjacent distinct pixels, which a reader is entitled to see individually |
fire-danger | ~550 m | cell-level aggregation; adjacent pixels are the same danger cell |

They are different because they answer different questions. Neither is a typo;
do not "harmonize" them without a ruling.

### A9 — `version` is not parsed on hotspots (P3, open)

FIRMS CSV carries a `version` column identifying the processing Collection. The
hotspots normalizer does not read it. Until it does, a response cannot prove
which Collection produced it, which is a precondition for A1. Logged as a P3.

---

## B. Process rules

Learned on 2026-09-30/10-01 across RS-1 … RS-O1. Each of these cost a real
mistake.

### B1 — The i18n bundle mixes encodings; sweeps MUST decode first

`i18n/kahuola-i18n.js` writes the same character three ways: literal UTF-8,
`\uXXXX`, and `\xXX`. A raw `grep` sees one form and misses the others.

**A raw grep over this bundle is not evidence.** Any audit decodes every string
value first (parse the `"key": "value"` pairs, `eval` the literal, search the
result). RS-2b's sweep was run with `grep` and reported clean; RS-2c then found
`map.fire_summary_n_nearest` still carrying the retired wording, because the
line was `\x`-escaped.

### B2 — Key counting must match multi-segment keys

Count keys with `[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+` — one dot is not enough.
A two-segment-only pattern silently ignores 174 three-segment keys
(`hero.title_html.red_flag`), so a "key count unchanged" gate can pass while a
key is added. Report **distinct** and **raw occurrence** counts, both measured
against `git show main:<file>`.

### B3 — Inline fallbacks must be byte-identical to the decoded bundle value

Every changed key has at least one inline fallback — a `||` default or the text
inside a `data-i18n` element. Set it **from the decoded bundle value**, never by
retyping, and assert equality.

Readers who hit the fallback are the ones whose bundle failed to load: the
worst moment to show them older, wronger copy. RS-3 found `gs.web_desc` still
promising real-time data in `index.html` after the bundle was corrected, and
only because the page was rendered with the bundle deliberately blocked.

### B4 — The `?v` token moves on every bundle change, on all three pages

`index.html`, `live-map.html` and `resources.html` each pin
`/i18n/kahuola-i18n.js?v=<sha256 prefix>`. All three are bumped together to the
same new value whenever the bundle changes. Letting them diverge means two cache
entries, a duplicate fetch, and a token that no longer means what its own
comment says.

### B5 — Character substitutions are verified by reversal

For a mechanical substitution, do not trust the edit. Compare each file against
`main` **character by character** and assert that every differing position is
either the intended substitution or an expected exception (the `?v` token).
Same-length substitutions make this exact: the file size must not change.

RS-O1 replaced 68 characters this way and proved 50 + 11 + 5 + 2 okina changes
and 21 token characters, with zero unaccounted-for differences.

### B6 — Duplicated logic drifts; prefer one source

Two hand-maintained copies of the same decision will diverge, and the dangerous
divergence is the one that does not throw.

The hero had two `titleMap`s with comments asking maintainers to keep them in
sync. They drifted in statement order and threw a `ReferenceError` on every
language switch in one state (RS-H1); the next drift would have been a missing
entry, which hit `|| titleMap.MONITORING` and published "Hawaiʻi is calm right
now." They are now one `heroTitleFor()` (RS-H3).

**An unknown hero state resolves to DEGRADED, never MONITORING.** A page that
cannot name what is happening says so. "Calm" is a claim and an unmapped state
has not earned it.

### B7 — Handlers always return 200, so "unverified" keys on the degraded signal

Invariant II requires every handler to return 200 with valid JSON. The
consequence: **a dead upstream resolves, it does not reject.** Code that tests
`settled.status === 'rejected'` to detect an outage is dead code.

Read each handler's own signal instead:

| source | observable |
|---|---|
FIRMS | `properties.health` — `ok` / `partial` / `degraded` |
flash-flood | `summary.status === 'unavailable'` |
NHC storm positions | `stormPositionsStatus()` → `active` / `none` / `unavailable` |

Fail closed: anything that is not a known-good value, **including a missing
field**, counts as unverified. RS-A2 found the morning brief publishing
*"No satellite heat detected in the latest passes"* through a total FIRMS
outage, because the outage arrived as `features: []`.

### B8 — Commands handed to Long carry no inline `#` comments

His shell is zsh. Put explanation in prose above the block, never after a
command on the same line.

### B9 — Fixtures are asserted programmatically, and harness bugs get reported

A fixture that is read by eye is not a test. Assert the property in code and
print PASS/FAIL per case.

Report harness bugs too — they are evidence about the system. Real examples:
`getItems()` checks `.signals` before `.features`, so an alerts fixture placed
in `.features` silently produced three "calm" renders; a zsh loop passed
`"older 2"` as one argument and four states quietly rendered MONITORING; a
summary ladder put `isOffline` first, so an unstubbed endpoint masked the line
under test. In each case the first result looked plausible.

When an assertion fails, establish whether the code or the assertion is wrong
before changing either. Several RS "failures" were over-broad assertions —
banning the substring "active" flagged `hero.banner.red_flag`, where an NWS
warning genuinely is in effect.

### B10 — The ʻokina is U+02BB

`ʻ` U+02BB MODIFIER LETTER TURNED COMMA. Never U+02BF (`ʿ`, used for ʿayn in
Semitic transliteration), never U+2018/U+2019 curly quotes, never ASCII `'`.

The ʻokina is a consonant in ʻŌlelo Hawaiʻi, not decoration. RS-O1 corrected 68
occurrences; `worker/`, `docs/`, `scripts/` and `kahuola-widget/` were already
correct.

### B11 — Locales reverted to EN pending native review

When copy is corrected and a translation cannot be corrected responsibly, the
locale is reverted to the corrected English and flagged — never left asserting
something untrue in a language we cannot write.

Open items, each carrying a `// NEEDS NATIVE REVIEW` comment in the bundle:

| key | locales | reverted in |
|---|---|---|
`gs.web_desc` | TL · ILO · JA · HAW | RS-C |
`how.step1_body` | TL · ILO · JA · HAW | RS-3 |
`hero.kicker.fire_active` | ILO · JA | RS-H2 |

**HAW must be reviewed with Kahele Dukelow before ʻŌlelo Hawaiʻi is restored.**
