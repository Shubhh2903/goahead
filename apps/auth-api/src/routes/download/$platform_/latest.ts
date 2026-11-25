import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import { downloadRouteResponse } from "../../../server/latest-download";

export const Route = createFileRoute("/download/$platform_/latest")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiEffect(downloadRouteResponse(params.platform, new URL(request.url).searchParams.get("arch"))),
    },
  },
});
