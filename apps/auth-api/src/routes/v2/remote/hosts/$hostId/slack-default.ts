import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

// The Slack workspace's default computer, for the host that proves its machine token. The token is
// a secret, so it goes in the body and the route takes only POST. With `slackUserId`, the default's
// owner hands the default over to that person's host first. The answer is the routing status after.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/slack-default")({
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
          const controlPlane = requestRemoteControlPlane();
          if (slackUserId !== undefined) {
            await controlPlane.handOverSlackDefault(params.hostId, body.machineToken, body.teamId, slackUserId);
          }
          return json(await controlPlane.slackRoutingStatus(params.hostId, body.machineToken, body.teamId));
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
