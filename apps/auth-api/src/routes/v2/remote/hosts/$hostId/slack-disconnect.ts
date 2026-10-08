import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

// Unlinks a Slack workspace from the host that proves its machine token. With `slackUserId`, only
// that person leaves the workspace; without it, the host leaves, as before multi-user Slack.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/slack-disconnect")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readJsonObject(request);
          if (!isString(body.machineToken) || !isString(body.teamId))
            return apiError(400, "invalid_remote_request", "The host credential is invalid.");
          const slackUserId = body.slackUserId;
          if (slackUserId !== undefined && !isString(slackUserId))
            return apiError(400, "invalid_remote_request", "The Slack person is invalid.");
          // `workspaceRemains` tells the host whether it may revoke the shared bot token.
          return json(
            await requestRemoteControlPlane().disconnectSlackWorkspace(
              params.hostId,
              body.machineToken,
              body.teamId,
              slackUserId,
            ),
          );
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
