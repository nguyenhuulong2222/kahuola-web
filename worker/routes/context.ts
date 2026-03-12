import { readJsonCache } from "../utils/cache";

export async function handleContext(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? "hawaii";

  if (url.pathname === "/v1/context/flood") {
    const data = (await readJsonCache<any[]>(env.CACHE, `hazard:flood:${region}`)) ?? [];
    return Response.json({
      status: "ok",
      region,
      items: data,
    });
  }

  if (url.pathname === "/v1/context/storm") {
    const data = (await readJsonCache<any[]>(env.CACHE, `hazard:storm:${region}`)) ?? [];
    return Response.json({
      status: "ok",
      region,
      items: data,
    });
  }

  return new Response("Not Found", { status: 404 });
}
