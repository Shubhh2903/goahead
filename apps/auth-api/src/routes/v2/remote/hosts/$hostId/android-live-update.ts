import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readAndroidLiveUpdateRelayPush } from "../../../../../server/android-live-update-relay";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestAndroidLiveUpdateRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

/**
 * A host sends one sealed Android live update for a member's phone. The body has the host
 * credential, the FCM token, and sealed bytes. Nothing of it is stored or logged.
 */
export const Route = createFileRoute("/v2/remote/hosts/$hostId/android-live-update")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readJsonObject(request);
          if (!isString(body.machineToken))
            return apiError(400, "invalid_remote_request", "The host credential is invalid.");
          const push = readAndroidLiveUpdateRelayPush(body);
          if (!push) return apiError(400, "invalid_live_update", "The Android live update is invalid.");
          await requestRemoteControlPlane().authenticateHost(params.hostId, body.machineToken);
          const relay = requestAndroidLiveUpdateRelay();
          if (!relay) return apiError(503, "live_update_unavailable", "Android live updates are not available.");
          if (!(await relay.allow(params.hostId))) {
            return apiError(429, "rate_limited", "Too many Android live updates.");
          }
          switch (await relay.sender.send(push)) {
            case "sent":
              return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
            case "gone":
              return apiError(410, "live_update_gone", "The phone no longer receives live updates.");
            case "rejected":
              return apiError(400, "live_update_rejected", "Firebase refused the live update.");
            case "unavailable":
              return apiError(503, "live_update_unavailable", "Firebase did not accept the update now.");
          }
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
