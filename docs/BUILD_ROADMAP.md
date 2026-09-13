# Kahu Ola — Build Roadmap

Track-by-track record of shipped and planned work.

> **Note on tracks A–E.** This file was created with TRACK F. Tracks A through E
> are referenced in planning but were not recorded here, and nothing in the repo
> carries them — the gap is real, not an accidental deletion. Add them above this
> section when their history is reconstructed; do not renumber TRACK F.

---

## TRACK F — Ocean Intelligence

- [x] **P23 · Ocean backend (/api/ocean/*)** — `DONE` 2026-09-12
  NDBC buoys (51001/51101/51205/51201) + PacIOOS SWAN + NWS surf zone (SRF/HFO)
  + NHC/CPHC tropical outlook. Worker ver d763df3d, PR #27.
  Notes: rip current risk does NOT exist upstream (HFO issues no risk product) —
  risk:null by design, never derive. Buoy 51101 dead for wave data (watch via
  source_health). Outlook geometry text-only (upstream KMZ/shapefile only).
- [x] **P24 · "Surf & Ocean Safety" card on index.html** — `DONE` 2026-09-12
  PR #28. Framing "Surf & Ocean Safety" (no risk badge). Feet-first display.
  40% threshold for tropical outlook lines. Isolated loader (Invariant 8).
  19 i18n keys EN/VI.
- [ ] **P25 · Ocean overlays on live-map** — `NOT-STARTED`
  Blocked on: map bug-clean (P01 Safari), KMZ-parse decision for outlook
  geometry (parse KMZ in Worker vs card-only, decide at implementation).

---

## UPDATE LOG

- 2026-09-12 — TRACK F opened. P23 + P24 shipped same day (backend ver d763df3d,
  PRs #27/#28). Ocean card moved to always-visible in follow-up.
