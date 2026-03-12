export async function handleStatus(_request: Request, _env: any): Promise<Response> {
  return Response.json({
    status: "ok",
    diagnostics: {
      message: "Diagnostics service not yet implemented",
    },
  });
}
