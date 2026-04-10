# NASA FIRMS Email Alert → n8n Setup

## Overview

NASA FIRMS (Fire Information for Resource Management System) supports email alerts
when satellite hotspots are detected inside a registered Area of Interest (AOI).
This document describes how to wire that alert into the existing n8n workflow
(`kahuola_n8n_workflow.json`) to post fire detections to Telegram/Facebook.

---

## Step 1: Register a FIRMS Account

URL: https://firms.modaps.eosdis.nasa.gov/usfs/api/area/

1. Sign in with Earthdata Login (create free account at https://urs.earthdata.nasa.gov if needed).
2. Navigate to **Fire Email Alerts** → **Manage Areas**.

---

## Step 2: Create AOI for Each Hawaiian Island

Create one AOI per island (or a single bounding box covering all main islands):

| Island | Approx. bbox (W, S, E, N) |
|--------|--------------------------|
| Kauaʻi | -160.0, 21.8, -159.2, 22.3 |
| Oʻahu | -158.4, 21.1, -157.5, 21.8 |
| Molokaʻi + Lānaʻi | -157.4, 20.6, -156.5, 21.3 |
| Maui | -156.8, 20.5, -155.9, 21.1 |
| Hawaiʻi Island | -156.2, 18.8, -154.7, 20.4 |

**Alert settings:**
- Satellite: VIIRS (375 m) — preferred over MODIS for small fires
- Alert trigger: **Any detection within AOI** (not just new fires)
- Email: `kahuola.alerts@gmail.com` (or whichever Gmail is connected to n8n)
- Frequency: Real-time (sent within ~15 min of satellite overpass)

---

## Step 3: Wire Gmail Trigger in n8n

The existing `kahuola_n8n_workflow.json` already has Facebook and Telegram post nodes.

1. Open n8n → Import workflow from `kahuola_n8n_workflow.json` if not already active.
2. Add a **Gmail Trigger** node:
   - Credential: the Gmail account receiving FIRMS alerts
   - Trigger on: New email
   - Filter by sender: `firms@firms.modaps.eosdis.nasa.gov`
3. Add a **Code** node to parse the FIRMS email body:
   - Extract: latitude, longitude, satellite, acquisition time, FRP (if present)
   - Format a short alert string: `"🔥 Fire detected — [Island] [lat],[lng] · [satellite] · [acq_time] UTC"`
4. Connect to existing **Telegram** and **Facebook** post nodes.
5. Optionally add a condition node to suppress alerts if `frp < 5 MW`
   (reduces false positives from agricultural burns).

---

## Step 4: Test

1. After saving the AOI in FIRMS, trigger a manual test email from the FIRMS portal.
2. Confirm n8n receives it and posts to Telegram.
3. Monitor for 24 hours across at least one VIIRS overpass (~10:30 AM / 10:30 PM HST).

---

## Notes

- FIRMS emails arrive within ~15 minutes of satellite overpass, faster than the
  `kahuola.org/api/firms/hotspots` Worker poll (which refreshes every 5 minutes).
- This alert path is for notification only — the Worker API is the authoritative
  source for the live-map display.
- FIRMS AOI alerts use the VIIRS 375 m product. The Worker API uses `VIIRS_SNPP_NRT`
  by default, which is the same dataset.
