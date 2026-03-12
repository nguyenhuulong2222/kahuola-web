import { readJsonCache, cacheKey } from "../utils/cache";

export async function handleContext(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? env.REGION ?? "hawaii";

  if (url.pathname === "/v1/context/flood") {
    const items = await readJsonCache<any[]>(
      env.CACHE,
      cacheKey("hazard", "flood", region),
    );

    return Response.json({
      status: "ok",
      region,
      items: items ?? [],
      count: items?.length ?? 0,
    });
  }

  if (url.pathname === "/v1/context/storm") {
    const items = await readJsonCache<any[]>(
      env.CACHE,
      cacheKey("hazard", "storm", region),
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
