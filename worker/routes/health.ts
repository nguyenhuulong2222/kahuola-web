export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  return Response.json({
    status: "healthy",
    service: env.PROJECT_NAME ?? "Kahu Ola",
    version: env.PROJECT_VERSION ?? "4.8",
    environment: env.ENVIRONMENT ?? "unknown",
  });
}
