/**
 * Kahu Ola V4.8
 * Hazard Intelligence Aggregator
 */

import { handleHome } from "./routes/home"
import { handleHazards } from "./routes/hazards"
import { handleContext } from "./routes/context"
import { handleHealth } from "./routes/health"
import { handleStatus } from "./routes/status"

export default {

  async fetch(request: Request, env: any): Promise<Response> {

    const url = new URL(request.url)
    const path = url.pathname

    try {

      if (path === "/v1/home/summary") {
        return handleHome(request, env)
      }

      if (path.startsWith("/v1/hazards")) {
        return handleHazards(request, env)
      }

      if (path.startsWith("/v1/context")) {
        return handleContext(request, env)
      }

      if (path === "/v1/system/health") {
        return handleHealth(request, env)
      }

      if (path === "/v1/system/status") {
        return handleStatus(request, env)
      }

      return new Response("Not Found", { status: 404 })

    } catch (err) {

      console.error("Worker error", err)

      return new Response(
        JSON.stringify({
          status: "error",
          message: "internal_error"
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        }
      )

    }

  }

}
