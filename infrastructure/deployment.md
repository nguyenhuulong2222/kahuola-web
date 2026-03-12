# Kahu Ola V4.8 Deployment

## Scope
This guide covers deployment of:
- Cloudflare Pages web frontend
- Cloudflare Worker API boundary
- Cloudflare KV snapshot cache

## 1. Pre-Deploy Checks
- Ensure no client-side direct upstream API calls.
- Ensure stale/degraded labeling paths are active.
- Ensure parser failures drop invalid records.
- Verify `worker/index.ts` routes match `/api/v1/*` public contract.

## 2. Worker Deploy
1. Configure `infrastructure/wrangler.toml` namespace IDs.
2. Set environment vars for upstream endpoints per environment.
3. Set secrets using Wrangler/dashboard (never commit values):
   - `NASA_FIRMS_API_KEY`
   - `AIRNOW_API_KEY`
4. Deploy:
   - `cd worker`
   - `wrangler deploy --config ..\infrastructure\wrangler.toml --env production`

## 3. Pages Deploy
- Project root: repository root
- Build command: none (static web)
- Output directory: `web`
- Ensure Pages project proxies `/api/*` to Worker routes.

## 4. Post-Deploy Verification
- `GET /api/v1/system/health`
- `GET /api/v1/system/status`
- `GET /api/v1/home/summary`
- Validate stale/degraded labeling in UI response fields.

## 5. Safety Constraints
- Production uses real upstream data only.
- No mock hazard values in production frontend.
- Secrets remain in Cloudflare env/secrets only.
- Homepage remains statewide and fail-safe under degraded upstreams.