# Cloudflare Pages — Redirect Behavior & Debug Guide

> **TL;DR:** Do NOT add `/portal`, `/privacy`, or `/support` to `_redirects`.
> Cloudflare Pages serves these automatically from `portal.html`, `privacy.html`,
> `support.html` via its built-in HTML stripping feature. Adding a redirect from
> `/portal → /portal.html` while Pages strips `.html` from URLs creates an
> infinite loop: `/portal → /portal.html → /portal → ...`

---

## How Cloudflare Pages serves HTML files

Cloudflare Pages applies **HTML clean URL routing** automatically at the CDN edge:

| File on disk  | URL served as | `.html` variant behaviour          |
|---------------|---------------|------------------------------------|
| `portal.html` | `/portal`     | `GET /portal.html` → 301 `/portal` |
| `privacy.html`| `/privacy`    | `GET /privacy.html` → 301 `/privacy`|
| `support.html`| `/support`    | `GET /support.html` → 301 `/support`|
| `index.html`  | `/`           | handled via `_redirects` rule below |

This happens **without any entry in `_redirects`**. It is not configurable — it
is always on for Cloudflare Pages projects.

---

## The loop that was causing ERR_TOO_MANY_REDIRECTS

```
Old _redirects (broken):
  /portal   /portal.html  301   ← our rule
  /privacy  /privacy.html 301
  /support  /support.html 301

Chain for GET /portal:
  1. Our rule fires:   /portal → 301 → /portal.html
  2. Pages strips .html: /portal.html → 301 → /portal
  3. Our rule fires again: /portal → 301 → /portal.html
  4. ∞ loop → ERR_TOO_MANY_REDIRECTS
```

---

## Current `_redirects` (correct — one rule only)

```
/index.html  /  301
```

The `index.html → /` rule is safe because Pages does **not** auto-strip
`index.html`; it only strips arbitrary `*.html` paths.

---

## Expected HTTP responses after fix

| Request                    | Expected response                        |
|----------------------------|------------------------------------------|
| `GET /portal`              | **200 OK** — serves `portal.html`        |
| `GET /portal.html`         | **301** → `/portal` (Pages strips `.html`)|
| `GET /privacy`             | **200 OK** — serves `privacy.html`       |
| `GET /privacy.html`        | **301** → `/privacy`                     |
| `GET /support`             | **200 OK** — serves `support.html`       |
| `GET /support.html`        | **301** → `/support`                     |
| `GET /`                    | **200 OK** — serves `index.html`         |
| `GET /index.html`          | **301** → `/` (our `_redirects` rule)    |

---

## Validation — curl commands

Replace `<host>` with `kahuola-web.pages.dev` or `kahuola.org`.

```bash
# Clean URLs must return 200 (no redirect)
curl -sI https://<host>/portal   | grep -E "^HTTP|^location"
curl -sI https://<host>/privacy  | grep -E "^HTTP|^location"
curl -sI https://<host>/support  | grep -E "^HTTP|^location"

# .html variants must redirect ONCE to clean URL (301, not loop)
curl -sI https://<host>/portal.html   | grep -E "^HTTP|^location"
curl -sI https://<host>/privacy.html  | grep -E "^HTTP|^location"
curl -sI https://<host>/support.html  | grep -E "^HTTP|^location"

# Follow redirects — must terminate in 200 with ≤ 2 hops
curl -sIL https://<host>/portal.html  | grep -E "^HTTP|^location"

# index.html redirect chain
curl -sI  https://<host>/index.html   | grep -E "^HTTP|^location"
curl -sIL https://<host>/index.html   | grep "^HTTP"
```

**Passing criteria:**
- `/portal`, `/privacy`, `/support` → `HTTP/2 200`
- `/portal.html`, `/privacy.html`, `/support.html` → `HTTP/2 301` + `location: /portal` (etc.)
- Following `.html` redirects terminates at `HTTP/2 200` in exactly one hop
- No response chain produces the same URL twice

---

## If the loop persists after deployment

1. **Check the Pages Redirects tab:** Cloudflare Dashboard → Pages project →
   **Settings** → **Redirects**. Confirm only `index.html → /` appears. If old
   rules appear there, they may have been set via the UI (not the file) and need
   to be deleted manually.

2. **Check deployment age:** Confirm a new deployment was triggered after the
   `_redirects` fix was pushed. Old deployments retain old rules.

3. **Clear browser cache / test in incognito:** `ERR_TOO_MANY_REDIRECTS` is
   sometimes a stale browser-side cookie or redirect cache. Test with `curl`
   first (curl is not affected by browser redirect caches).

4. **Check for `Set-Cookie` redirect loops:** If a cookie is setting a redirect
   target that loops, it will only reproduce in browsers. `curl -b /dev/null`
   isolates this.

---

## Rules for maintaining this config

- **Never** add a rule for `/portal`, `/privacy`, or `/support` in `_redirects`.
- **Never** link to `*.html` internally — always use clean paths (`/portal`, etc.).
- **Only** the `index.html → /` rule belongs in `_redirects` (and even that is
  optional; it just ensures `index.html` typed directly redirects cleanly).
- Canonical `<link>` tags must point to clean URLs, never `*.html` variants.
