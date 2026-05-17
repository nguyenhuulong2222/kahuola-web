# Kahu Ola Embeddable Safety Widget

Phase 1 — Safe Widget Skeleton. A lightweight, zero-dependency Web Component that partner sites (hotels, HOA pages, local blogs) embed to show calm Hawaiʻi hazard status, with a natural backlink to Kahu Ola.

## Placement in the repo

This is a **second, independent Worker** inside the `kahuola-web` monorepo — a sibling of `worker/`, not part of it:

```
kahuola-web/
├── worker/            ← main hazard Worker (kahuola.org/api/*)
└── kahuola-widget/    ← THIS — growth widget (widget.kahuola.org/v1/*)
    ├── src/index.ts
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.toml
    └── .gitignore
```

It is deliberately separate so widget traffic cannot overload the main hazard system during high-traffic emergency events (`KAHU_OLA_GROWTH_FEATURES.md` §2). It has its own `wrangler.toml` and deploys independently.

To install it: drop this `kahuola-widget/` folder at the repo root next to `worker/`, then `git add kahuola-widget && git commit`.

## What this is (and is not)

This widget shows **situational awareness status only**. It does not issue evacuation orders or emergency directives, and does not represent any official authority. During an active hazard it routes attention to official sources (NWS, HIEMA, county emergency management) via the Kahu Ola site.

Phase 1 renders **placeholder data** to prove the skeleton: Shadow DOM isolation, the degraded-fallback path, and the attribution backlink. Live data is wired in Phase 3 — the widget Worker reads cached status from the main Kahu Ola Worker API **server-side**; the browser never calls upstream government APIs.

## Doctrine compliance

| Invariant | How this widget satisfies it |
|---|---|
| I — Client stateless | Browser loads only `widget.kahuola.org`. Phase 3 data fetch happens Worker-side from `kahuola.org/api/*`. Never NASA/NOAA/NWS/EPA/USGS/PacIOOS. |
| II — Render under failure | Web Component paints a card on `connectedCallback` unconditionally. No data path can blank it. |
| III — Fail closed | Phase 3 fetch wrapped in try/catch; any parse/network failure keeps the degraded card, never infers fields. |
| IV — Zero PII | No geolocation API, no identifiers, no transmission of user data. `location` is a static place name set by the host site. |
| V — Perimeter integrity | Status text only; no perimeter or official-boundary claims. |

## Run locally

```bash
cd kahuola-widget
npm install
npm run dev
```

Expected local URL: `http://localhost:8787`

- `http://localhost:8787/v1/embed.js` — the Web Component loader
- `http://localhost:8787/v1/health` — JSON status (booleans only, no secrets/PII)

## Test the embed script

Create a throwaway `test.html` and open it in a browser:

```html
<!doctype html>
<html>
  <body style="background:#222;padding:40px">
    <script src="http://localhost:8787/v1/embed.js" defer></script>
    <kahuola-safety-widget location="wailuku" theme="light"></kahuola-safety-widget>
    <kahuola-safety-widget location="lahaina" theme="dark"></kahuola-safety-widget>
  </body>
</html>
```

Two isolated cards (Shadow DOM — host CSS cannot leak in or out), each with a "Powered by Kahu Ola" link.

## Example partner embed code

```html
<script src="https://widget.kahuola.org/v1/embed.js" defer></script>
<kahuola-safety-widget location="wailuku" theme="light"></kahuola-safety-widget>
```

Attributes: `location` (`wailuku`, `lahaina`, `kihei`, `maui`, … — static place name, no GPS) and `theme` (`light` | `dark`).

## Deploy

Manual only. GitHub Actions deploys Pages (HTML), never Workers.

```bash
cd kahuola-widget
npm install
npm run deploy          # = npx wrangler deploy
npm run health          # = curl -sL https://widget.kahuola.org/v1/health
```

Prerequisite: a `widget.kahuola.org` DNS record on the Cloudflare `kahuola.org` zone (account-side change — do this in the Cloudflare dashboard).

## Phase roadmap

- **Phase 1 (this):** skeleton, placeholder data, Shadow DOM proven, backlink live.
- **Phase 3:** widget Worker fetches cached hazard status from `https://kahuola.org/api/*` server-side; adds `fresh` / `stale` states with honest freshness labels.
