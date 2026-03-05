# Cloudflare Pages Deployment Checklist — kahuola.org

> Static site (no build step). Worker handles `/api/*`.
> Keep this file updated when deployment config changes.

---

## 1. Pre-flight

- [ ] Repo is up to date on `main` (or whichever branch you deploy from)
- [ ] `_headers`, `_redirects`, `robots.txt`, `sitemap.xml` are committed
- [ ] All internal links use relative paths (`./index.html`, `./portal.html`, etc.)
- [ ] All `/api/` fetch calls use `location.origin` (no hardcoded domains) — already confirmed in `portal.html`

---

## 2. Create Cloudflare Pages Project

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Pages**
2. Click **Create a project** → **Connect to Git**
3. Authorize Cloudflare to access your GitHub account
4. Select the `kahuola-web` repository
5. Configure build settings:

   | Setting             | Value              |
   |---------------------|--------------------|
   | Framework preset    | **None**           |
   | Build command       | *(leave empty)*    |
   | Build output dir    | `/` (root)         |
   | Root directory      | *(leave empty)*    |
   | Environment vars    | *(none required)*  |

6. Click **Save and Deploy**

Cloudflare Pages will copy all files from the repo root and serve them. `_headers` and `_redirects` are processed automatically by Cloudflare Pages.

---

## 3. Custom Domain — kahuola.org

### If kahuola.org DNS is already on Cloudflare:

1. In your Pages project → **Custom domains** → **Set up a custom domain**
2. Enter `kahuola.org`
3. Cloudflare will automatically add a `CNAME` record pointing to your Pages domain (e.g. `kahuola-web.pages.dev`)
4. Also add `www.kahuola.org` as an alias or redirect if needed

### If DNS is elsewhere (e.g. Namecheap, GoDaddy):

1. Add a `CNAME` record at your DNS provider:
   ```
   Name:  kahuola.org  (or @)
   Type:  CNAME
   Value: kahuola-web.pages.dev
   TTL:   Auto or 300
   ```
   > Note: some registrars don't allow CNAME on apex (`@`). In that case, use Cloudflare nameservers (recommended) or an `ALIAS`/`ANAME` record if supported.

2. Recommended: migrate DNS to Cloudflare nameservers for full control (Pages + Worker routing on same zone)

---

## 4. Cloudflare Worker — `/api/*` Routing

The live map (`portal.html`) calls `/api/firms/hotspots` and other routes through a Cloudflare Worker. Two valid patterns:

### Option A — Same-domain route (recommended for kahuola.org)

In Cloudflare Dashboard → **Workers & Pages** → your Worker → **Triggers** → **Add Route**:

```
Route:  kahuola.org/api/*
Zone:   kahuola.org
```

This makes `https://kahuola.org/api/*` resolve to your Worker, while all other paths are served by Pages. No changes to `portal.html` needed since all fetches already use `/api/...` relative to `location.origin`.

### Option B — Subdomain route

```
Route:  api.kahuola.org/*
```

If using this option, update all `new URL("/api/...", location.origin)` calls in `portal.html` to use `https://api.kahuola.org/...` directly. **Avoid this unless you have a specific reason.**

**Option A is the chosen approach.** The Worker is already wired to handle `kahuola.org/api/*`.

---

## 5. SSL / HTTPS

Cloudflare Pages provides automatic SSL via Universal SSL (Let's Encrypt / Cloudflare CA). No manual cert steps required.

- SSL mode: **Full (strict)** if your origin supports SSL; **Full** otherwise
- HTTP → HTTPS redirect: enabled automatically on Cloudflare Pages

---

## 6. Post-Deploy Verification

After DNS propagates (usually < 5 min on Cloudflare, up to 48h on external DNS):

| Check                              | Expected result                                  |
|------------------------------------|--------------------------------------------------|
| `https://kahuola.org/`             | Serves `index.html` (home page)                  |
| `https://kahuola.org/index.html`   | Redirects 301 → `https://kahuola.org/`           |
| `https://kahuola.org/portal.html`  | Serves live map page                             |
| `https://kahuola.org/portal`       | Redirects 301 → `/portal.html`                   |
| `https://kahuola.org/privacy.html` | Serves privacy page                              |
| `https://kahuola.org/support.html` | Serves support page                              |
| `https://kahuola.org/api/health`   | Worker responds (if `/api/health` is implemented)|
| Response headers                   | Includes `X-Content-Type-Options: nosniff`, etc. |
| `https://kahuola.org/robots.txt`   | Returns robots.txt                               |
| `https://kahuola.org/sitemap.xml`  | Returns sitemap                                  |

Use browser DevTools → Network tab to verify `Cache-Control` and security headers on each response.

---

## 7. Rollback

1. Cloudflare Dashboard → **Pages** → your project → **Deployments**
2. Find the last known-good deployment
3. Click **...** → **Rollback to this deployment**

Rollback is instant (Cloudflare switches traffic immediately, no re-build).

---

## 8. GitHub Pages Migration

Once Cloudflare Pages is confirmed working:

1. In GitHub repo → **Settings** → **Pages** → set Source to **None** (disables GitHub Pages)
2. Remove any `CNAME` file in the repo if it exists (GitHub Pages artifact)
3. Update DNS to point to Cloudflare Pages instead of `github.io`

---

## 9. Notes

- No build step or framework — Cloudflare Pages serves the repo root as-is
- `_headers` and `_redirects` are Cloudflare Pages native config (no Webpack/build pipeline needed)
- Cache-busting for `styles.css` and `layers.config.js` is handled via `?v=X.X.X` querystrings in HTML; the `immutable` cache header is safe to use alongside querystring versioning
- Do not commit secrets or API keys; the Worker handles all upstream API authentication server-side
