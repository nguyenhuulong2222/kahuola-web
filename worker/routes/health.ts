export async function handleHealth(_request: Request, _env: any): Promise<Response> {
  return Response.json({
    status: "healthy",
    service: "kahuola-worker",
    version: "4.8",
  });
}
