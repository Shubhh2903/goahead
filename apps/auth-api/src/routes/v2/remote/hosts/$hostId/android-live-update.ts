import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readAndroidLiveUpdateRelayPush } from "../../../../../server/android-live-update-relay";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestAndroidLiveUpdateRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/android-live-update")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            const push = readAndroidLiveUpdateRelayPush(body);
            if (!push) return apiError(400, "invalid_live_update", "The Android live update is invalid.");
            yield* requestRemoteControlPlane().authenticateHost(params.hostId, body.machineToken);
            const relay = requestAndroidLiveUpdateRelay();
            if (!relay) return apiError(503, "live_update_unavailable", "Android live updates are not available.");
            if (!(yield* Effect.tryPromise(() => relay.allow(params.hostId)))) {
              return apiError(429, "rate_limited", "Too many Android live updates.");
            }
            switch (yield* Effect.tryPromise(() => relay.sender.send(push))) {
              case "sent":
                return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
              case "gone":
                return apiError(410, "live_update_gone", "The phone no longer receives live updates.");
              case "rejected":
                return apiError(400, "live_update_rejected", "Firebase refused the live update.");
              case "unavailable":
                return apiError(503, "live_update_unavailable", "Firebase did not accept the update now.");
            }
            return apiError(503, "live_update_unavailable", "Firebase did not accept the update now.");
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
