import { readJsonCache, cacheKey } from "../utils/cache";

export async function handleHazards(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? env.REGION ?? "hawaii";

  if (url.pathname === "/v1/hazards/fire") {
    const items = await readJsonCache<any[]>(
      env.CACHE,
      cacheKey("hazard", "fire", region),
    );

    return Response.json({
      status: "ok",
      region,
      items: items ?? [],
      count: items?.length ?? 0,
    });
  }

  return new Response("Not Found", { status: 404 });
}
