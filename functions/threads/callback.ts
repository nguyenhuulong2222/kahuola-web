/**
 * Threads OAuth Callback Handler
 * Route: /threads/callback
 *
 * Called by Meta after the user authorizes the Threads app.
 * Receives either:
 *   - `?code=<auth_code>` on success
 *   - `?error=<error>&error_description=<desc>` on failure
 */
export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (error) {
    return new Response(
      JSON.stringify({
        status: "error",
        error,
        error_description: errorDescription ?? "Unknown error",
        timestamp: new Date().toISOString(),
      }),
      { status: 400, headers }
    );
  }

  if (!code) {
    return new Response(
      JSON.stringify({
        status: "error",
        error: "missing_code",
        error_description: "No authorization code received",
        timestamp: new Date().toISOString(),
      }),
      { status: 400, headers }
    );
  }

  // Successfully received the authorization code.
  // Return it as JSON so the n8n workflow or operator can exchange it for a token.
  return new Response(
    JSON.stringify({
      status: "success",
      code,
      message: "Authorization code received. Exchange this for an access token.",
      next_step: "POST https://graph.threads.net/oauth/access_token",
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers }
  );
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};
