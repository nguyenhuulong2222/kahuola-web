import { readJsonCache } from "../utils/cache";

export async function handleHazards(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/v1/hazards/fire") {
    const data = (await readJsonCache(env.CACHE, "hazard:fire:hawaii")) ?? [];
    return Response.json({ items: data });
  }

  return new Response("Not Found", { status: 404 });
}
