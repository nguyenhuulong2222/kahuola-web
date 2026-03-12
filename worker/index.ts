import { handleHome } from "./routes/home";
import { handleHazards } from "./routes/hazards";
import { handleContext } from "./routes/context";
import { handleHealth } from "./routes/health";
import { handleStatus } from "./routes/status";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/v1/home/summary") {
        return handleHome(request, env);
      }

      if (path.startsWith("/v1/hazards")) {
        return handleHazards(request, env);
      }

      if (path.startsWith("/v1/context")) {
        return handleContext(request, env);
      }

      if (path === "/v1/system/health") {
        return handleHealth(request, env);
      }

      if (path === "/v1/system/status") {
        return handleStatus(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Unhandled worker error:", err);

      return Response.json(
        {
          status: "error",
          message: "internal_error",
        },
        { status: 500 },
      );
    }
  },
};
