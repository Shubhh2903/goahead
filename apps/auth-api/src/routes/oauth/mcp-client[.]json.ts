import { createFileRoute } from "@tanstack/solid-router";

const CLIENT_ID = "https://goahead.multicodegenius.com/oauth/mcp-client.json";

function mcpClientMetadataResponse(): Response {
  return Response.json(
    {
      client_id: CLIENT_ID,
      client_name: "GoAhead",
      client_uri: "https://goahead.multicodegenius.com",
      logo_uri: "https://goahead.multicodegenius.com/icon-512x512.png",
      redirect_uris: ["http://127.0.0.1:28417/mcp-auth"],
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } },
  );
}

export const Route = createFileRoute("/oauth/mcp-client.json")({
  server: { handlers: { GET: mcpClientMetadataResponse } },
});
