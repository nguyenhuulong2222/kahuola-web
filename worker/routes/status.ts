import { nowIso } from "../utils/time";

export async function handleStatus(_request: Request, env: Env): Promise<Response> {
  return Response.json({
    status: "ok",
    project: env.PROJECT_NAME ?? "Kahu Ola",
    version: env.PROJECT_VERSION ?? "4.8",
    environment: env.ENVIRONMENT ?? "unknown",
    generated_at: nowIso(),
    diagnostics: {
      worker_boundary: "active",
      cache_first: true,
      upstream_direct_from_client: false,
    },
  });
}