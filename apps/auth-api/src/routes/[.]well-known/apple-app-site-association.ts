import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { createAppleAppSiteAssociationResponse } from "../../server/apple-app-site-association";
import { requireWorkerBindings } from "../../server/types";

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: () => createAppleAppSiteAssociationResponse(requireWorkerBindings(env)),
    },
  },
});
