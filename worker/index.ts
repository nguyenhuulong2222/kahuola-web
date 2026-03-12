import { handleHome } from "./routes/home";
import { handleHazards } from "./routes/hazards";
import { handleContext } from "./routes/context";
import { handleHealth } from "./routes/health";
import { handleStatus } from "./routes/status";

function normalizePath(pathname: string): string {
  return pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    try {
      let response: Response;

      if (path === "/v1/home/summary") {
        response = await handleHome(request, env);
        return withCors(response);
      }

      if (path.startsWith("/v1/hazards")) {
        response = await handleHazards(
          new Request(new URL(path + url.search, url.origin), request),
          env,
        );
        return withCors(response);
      }

      if (path.startsWith("/v1/context")) {
        response = await handleContext(
          new Request(new URL(path + url.search, url.origin), request),
          env,
        );
        return withCors(response);
      }

      if (path === "/v1/system/health") {
        response = await handleHealth(request, env);
        return withCors(response);
      }

      if (path === "/v1/system/status") {
        response = await handleStatus(request, env);
        return withCors(response);
      }

      return withCors(new Response("Not Found", { status: 404 }));
    } catch (err) {
      console.error("Unhandled worker error:", err);
      return withCors(
        Response.json(
          {
            status: "error",
            message: "internal_error",
          },
          { status: 500 },
        ),
      );
    }
  },
};