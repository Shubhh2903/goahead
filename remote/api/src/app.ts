import { SLACK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/slack-route";
import { Elysia } from "elysia";
import { z } from "zod";
import type { RemoteApiConfig } from "./config";
import { handleAuthEvent, handleSlackEvents } from "./http-routes";
import type { SignalService, SignalSocket, SlackAudienceLookup } from "./signal-service";
import { SlackAuthorizations } from "./slack-authorizations";

export function createRemoteApiApp(
  config: RemoteApiConfig,
  signal: SignalService,
  // Asks Slack who may see a message event, with the app's `SLACK_APP_TOKEN`.
  slackAudience: SlackAudienceLookup = new SlackAuthorizations({
    appToken: (appId) => config.slackAppTokens.find((entry) => entry.appId === appId)?.token ?? null,
  }),
) {
  const app = new Elysia()
    .get("/health/live", () => ({ service: "openbot-remote-api", status: "live" }))
    .get("/health/ready", () => ({ service: "openbot-remote-api", status: "ready" }))
    .post("/internal/auth-events", ({ request }) => handleAuthEvent(request, config, signal))
    // The Slack app's one request URL (see `http-routes.ts`).
    .post(
      SLACK_EVENTS_PATH,
      ({ request, server }) =>
        handleSlackEvents(request, config, signal, slackAudience, () =>
          signalClientIp(
            server?.requestIP(request)?.address,
            request.headers.get("x-forwarded-for"),
            config.trustProxy,
          ),
        ),
      { parse: "none" },
    )
    .ws("/v1/signal", {
      idleTimeout: 120,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 256 * 1024,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
      open(ws) {
        signal.connect(socketAdapter(ws, config.trustProxy));
      },
      async message(ws, message) {
        const socket = socketAdapter(ws, config.trustProxy);
        const textMessage = z.string().safeParse(message);
        const input = textMessage.success
          ? textMessage.data
          : message instanceof Uint8Array
            ? message
            : JSON.stringify(message);
        await signal.receive(socket, input);
      },
      close(ws) {
        signal.disconnect(socketAdapter(ws, config.trustProxy));
      },
      error({ error }) {
        console.error("Remote signal WebSocket failed.", error instanceof Error ? error.message : "Unknown error");
      },
    });
  return app;
}

interface ElysiaSocketLike {
  id: string;
  data?: { request?: Request };
  remoteAddress?: string;
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}

function socketAdapter(ws: ElysiaSocketLike, trustProxy: boolean): SignalSocket {
  return {
    id: ws.id,
    ip: signalClientIp(ws.remoteAddress, ws.data?.request?.headers.get("x-forwarded-for"), trustProxy),
    send: (message) => {
      ws.send(message);
    },
    close: (code, reason) => ws.close(code, reason.slice(0, 123)),
  };
}

export function signalClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | null | undefined,
  trustProxy: boolean,
) {
  if (!trustProxy) return remoteAddress ?? "unknown";
  const forwarded = forwardedFor?.split(",", 1)[0]?.trim();
  return forwarded || remoteAddress || "unknown";
}

export function prometheusMetrics(signal: SignalService): string {
  const metrics = signal.metrics();
  return [
    "# TYPE openbot_remote_signal_sockets gauge",
    `openbot_remote_signal_sockets ${metrics.activeSockets}`,
    "# TYPE openbot_remote_peer_connections gauge",
    `openbot_remote_peer_connections ${metrics.activePeerConnections}`,
    "# TYPE openbot_remote_signal_messages_total counter",
    `openbot_remote_signal_messages_total ${metrics.relayedMessages}`,
    "# TYPE openbot_remote_auth_failures_total counter",
    `openbot_remote_auth_failures_total ${metrics.authenticationFailures}`,
    "# TYPE openbot_remote_protocol_failures_total counter",
    `openbot_remote_protocol_failures_total ${metrics.protocolFailures}`,
    "# TYPE openbot_remote_slack_deliveries_total counter",
    `openbot_remote_slack_deliveries_total ${metrics.slackDeliveries}`,
    "# TYPE openbot_remote_slack_deliveries_unavailable_total counter",
    `openbot_remote_slack_deliveries_unavailable_total ${metrics.slackDeliveriesUnavailable}`,
    "",
  ].join("\n");
}
