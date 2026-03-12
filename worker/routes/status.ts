export async function handleStatus(_request: Request, env: Env): Promise<Response> {
  return Response.json({
    status: "ok",
    project: env.PROJECT_NAME ?? "Kahu Ola",
    version: env.PROJECT_VERSION ?? "4.8",
    environment: env.ENVIRONMENT ?? "unknown",
    diagnostics: {
      message: "status endpoint live",
    },
  });
}
