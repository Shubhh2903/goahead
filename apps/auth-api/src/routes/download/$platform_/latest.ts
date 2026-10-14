import { createFileRoute } from "@tanstack/solid-router";
import { downloadRouteResponse } from "../../../server/latest-download";

// The installer itself. `/download/<platform>` is the page that describes it, and every download
// button on the site links here. Only macOS on Apple silicon has an installer. `?arch=x64` (an Intel
// Mac), Windows and Linux go to the page of their system, which says that it is not available yet.
export const Route = createFileRoute("/download/$platform_/latest")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        downloadRouteResponse(params.platform, new URL(request.url).searchParams.get("arch")),
    },
  },
});
