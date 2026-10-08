import {
  isDefaultSlackRoute,
  SLACK_ROUTE_TTL_SECONDS,
  type SlackRouteTeam,
} from "@openbot/contracts/signal-protocol/slack-route";
import {
  decodeSignalClientMessage,
  encodeSignalServerMessage,
  type IceServer,
  type RemoteTicketClaims,
  SIGNAL_MESSAGE_BYTES_LIMIT,
  type SignalClientMessage,
  type SignalErrorCode,
  type SignalServerMessage,
  type SlackDeliveryKind,
  type SlackDeliveryStatus,
} from "./protocol";
import type { SlackAuthorizations } from "./slack-authorizations";
import type { SlackTarget } from "./slack-targets";

/** The workspaces a verified route ticket names, each with the time it was linked to the host. */
export interface SlackRoute {
  teams: SlackRouteTeam[];
}

/**
 * The account service's answer for a route ticket while Signal starts. `teams` lists the workspaces
 * where the host is still the default. `routes`, absent from an account service made before
 * multi-user Slack, reduces each ticket entry to the default link and the people that still hold.
 */
export interface SlackRouteValidation {
  teams: string[];
  routes?: SlackRouteTeam[];
}

export interface RemoteTokenProvider {
  verifyTicket(token: string): Promise<RemoteTicketClaims>;
  verifyResumeToken(token: string): Promise<RemoteTicketClaims>;
  validateClaims(claims: RemoteTicketClaims): Promise<boolean>;
  issueResumeToken(claims: RemoteTicketClaims): Promise<string>;
  iceServers(claims: RemoteTicketClaims): IceServer[];
  /** The Slack workspaces a route ticket links to the host. Without it, no `ingress` socket connects. */
  verifySlackRoute?(token: string, hostId: string): Promise<SlackRoute>;
  /** The parts of a route that the account service still links to the host, with the same link. */
  validateSlackRoute?(hostId: string, teams: SlackRouteTeam[]): Promise<SlackRouteValidation>;
  revokeHost?(hostId: string, authEpoch: number): void;
  revokeSession?(sessionId: string): void;
}

export interface SignalSocket {
  id: string;
  ip: string;
  send(message: string): void;
  close(code: number, reason: string): void;
}

interface AuthenticatedPeer {
  socket: SignalSocket;
  claims: RemoteTicketClaims;
  peer: "host" | "client" | "ingress";
  connectionId: string | null;
  resumed: boolean;
  multiplex: boolean;
  // `ingress` only: the routes this socket holds. Default routes are `<app ID>:<workspace ID>`;
  // person routes are `<app ID>:<workspace ID>:<Slack user ID>`.
  slackDefaults: string[];
  slackPeople: string[];
}

interface ActiveConnection {
  id: string;
  hostId: string;
  sessionId: string;
  client: SignalSocket;
  host: SignalSocket;
}

export interface SignalMetrics {
  acceptedConnections: number;
  authenticationFailures: number;
  protocolFailures: number;
  relayedMessages: number;
  activeSockets: number;
  activePeerConnections: number;
  slackDeliveries: number;
  slackDeliveriesUnavailable: number;
}

/** One signed Slack request for a workspace. Signal passes it on and keeps nothing of it. */
export interface SlackDelivery {
  kind: SlackDeliveryKind;
  retryNum: number | null;
  retryReason: string | null;
  body: Uint8Array;
}

/** A Slack request with the event ID that keys Slack's list of who may see it. */
export interface SlackTargetedDelivery extends SlackDelivery {
  eventId: string | null;
}

/** Who may see one event, from `apps.event.authorizations.list` (see `slack-authorizations.ts`). */
export type SlackAudienceLookup = Pick<SlackAuthorizations, "usersFor">;

interface SlackFanOut {
  sockets: string[];
  defaultSocket: string | null;
}

export interface SlackDeliveryResponse {
  status: SlackDeliveryStatus;
  contentType?: "application/json" | "text/plain";
  body?: string;
}

interface PendingDelivery {
  socketId: string;
  hostId: string;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(response: SlackDeliveryResponse): void;
}

export interface SlackDeliveryLimits {
  /** How long Signal waits for the host. Slack gives up after 3 seconds. */
  timeoutMilliseconds: number;
  maximumPendingPerHost: number;
  maximumPendingBytesPerHost: number;
  maximumPending: number;
}

/**
 * The bytes in flight to one host stay under the socket's 256 KB backpressure limit, which closes
 * the socket when it is reached. A body travels as base64, a third larger than the body.
 */
const DEFAULT_SLACK_DELIVERY_LIMITS: SlackDeliveryLimits = {
  timeoutMilliseconds: 2_500,
  maximumPendingPerHost: 16,
  maximumPendingBytesPerHost: 128 * 1024,
  maximumPending: 1_000,
};

const UNAVAILABLE: SlackDeliveryResponse = { status: 503 };

const MAXIMUM_RATE_WINDOWS = 100_000;
const RATE_WINDOW_MILLISECONDS = 60_000;
const SIGNAL_RECONNECT_GRACE_MILLISECONDS = 30_000;
const INITIAL_TICKET_TTL_MILLISECONDS = 3 * 60_000;
const MAXIMUM_EXPIRATION_TIMER_MILLISECONDS = 24 * 60 * 60_000;
const INGRESS_RATE_FACTOR = 10;
// Slack sends at most 30,000 events an hour for one app in one workspace.
const SLACK_TEAM_RATE_FACTOR = 2;

export class SignalService {
  readonly #tokens: RemoteTokenProvider;
  readonly #maximumConnectionsPerUser: number;
  readonly #maximumConnectionsPerIp: number;
  readonly #maximumMessagesPerMinute: number;
  readonly #sockets = new Map<string, SignalSocket>();
  readonly #peers = new Map<string, AuthenticatedPeer>();
  readonly #hosts = new Map<string, Set<string>>();
  // `<app ID>:<workspace ID>` to the `ingress` socket of the workspace's default computer: the newest
  // route ticket that names this host as the default. It answers people without their own route.
  readonly #slackDefaults = new Map<string, string>();
  // `<app ID>:<workspace ID>:<Slack user ID>` to the `ingress` socket of that person's own host.
  readonly #slackPeople = new Map<string, string>();
  // The oldest link that each route (of both kinds) still accepts: the link of its current route, or
  // the moment after the account service revoked it. A host that lost a route keeps its last ticket
  // until it expires; this keeps that ticket from taking the route back.
  readonly #slackRouteFloor = new Map<string, number>();
  // The default routes (`<app ID>:<workspace ID>`) held by a ticket entry without `isDefault`, from a
  // host made before multi-user Slack. Such a host still gets the people's messages of every person
  // who never had an own route in the workspace, as it did then.
  readonly #slackLegacyDefaults = new Set<string>();
  // `<app ID>:<workspace ID>` to the people with an own route (on any host), from the ticket entry of
  // the socket that holds the default route. It keeps the default from answering them after a
  // restart, when the route floors are empty.
  readonly #slackRoutedUsers = new Map<string, Set<string>>();
  // The person routes that a host registered and the account service did not revoke since. A person
  // stays here while their host is offline, so the default does not answer them; a revoke (the person
  // left or moved) removes them, and a move registers them again from the new host.
  readonly #slackKnownPeople = new Set<string>();
  readonly #pendingDeliveries = new Map<string, PendingDelivery>();
  readonly #slackLimits: SlackDeliveryLimits;
  readonly #connections = new Map<string, ActiveConnection>();
  readonly #connectionDropTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #peerExpirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #usedTicketIds = new Map<string, number>();
  readonly #revokedEpochs = new Map<string, number>();
  readonly #revokedSessions = new Map<string, number>();
  readonly #rateWindows = new Map<string, { startedAt: number; count: number }>();
  readonly #validateInitialTicketsUntil = Date.now() + INITIAL_TICKET_TTL_MILLISECONDS;
  // The revocations below are in memory. Until every route ticket issued before this start has
  // expired, the account service confirms each link.
  readonly #validateSlackRoutesUntil = Date.now() + SLACK_ROUTE_TTL_SECONDS * 1_000;
  #lastRatePruneAt = 0;
  readonly #metrics: SignalMetrics = {
    acceptedConnections: 0,
    authenticationFailures: 0,
    protocolFailures: 0,
    relayedMessages: 0,
    activeSockets: 0,
    activePeerConnections: 0,
    slackDeliveries: 0,
    slackDeliveriesUnavailable: 0,
  };

  constructor(
    tokens: RemoteTokenProvider,
    maximumConnectionsPerUser: number,
    maximumConnectionsPerIp = 32,
    maximumMessagesPerMinute = 600,
    slackLimits: SlackDeliveryLimits = DEFAULT_SLACK_DELIVERY_LIMITS,
  ) {
    this.#tokens = tokens;
    this.#maximumConnectionsPerUser = maximumConnectionsPerUser;
    this.#maximumConnectionsPerIp = maximumConnectionsPerIp;
    this.#maximumMessagesPerMinute = maximumMessagesPerMinute;
    this.#slackLimits = slackLimits;
  }

  connect(socket: SignalSocket): boolean {
    if (this.#sockets.has(socket.id)) return true;
    if (this.#socketIpCount(socket.ip) >= this.#maximumConnectionsPerIp) {
      this.#fail(socket, "rate_limited", "Too many remote connections from this address.", 1008);
      return false;
    }
    this.#sockets.set(socket.id, socket);
    this.#metrics.activeSockets = this.#sockets.size;
    return true;
  }

  async receive(socket: SignalSocket, input: string | Uint8Array): Promise<void> {
    if (!this.#acceptMessage(socket)) {
      this.#fail(socket, "rate_limited", "Too many signal messages.", 1008);
      return;
    }
    const text = input instanceof Uint8Array ? new TextDecoder().decode(input) : input;
    if (new TextEncoder().encode(text).byteLength > SIGNAL_MESSAGE_BYTES_LIMIT) {
      this.#fail(socket, "invalid_message", "Signal message is too large.", 1009);
      return;
    }
    let message: SignalClientMessage;
    try {
      message = decodeSignalClientMessage(JSON.parse(text));
    } catch {
      this.#metrics.protocolFailures += 1;
      this.#fail(socket, "invalid_message", "Signal message is invalid.", 1003);
      return;
    }
    if (message.type === "hello") {
      await this.#authenticate(socket, message);
      return;
    }
    const peer = this.#peers.get(socket.id);
    if (!peer) {
      this.#fail(socket, "authentication_required", "Authenticate before sending signal messages.", 1008);
      return;
    }
    if (message.type === "turn-refresh") {
      if (peer.claims.sessionExpiresAt <= Math.floor(Date.now() / 1_000)) {
        this.#fail(socket, "authentication_required", "The remote session expired.", 1008);
        return;
      }
      if (message.connectionId !== null && !this.#ownsConnection(peer, message.connectionId)) {
        this.#fail(socket, "permission_denied", "The connection does not belong to this peer.");
        return;
      }
      this.#send(socket, {
        type: "ready",
        version: 1,
        connectionId: message.connectionId,
        resumeToken: await this.#tokens.issueResumeToken(peer.claims),
        iceServers: this.#tokens.iceServers(peer.claims),
      });
      return;
    }
    if (message.type === "disconnect") {
      if (this.#ownsConnection(peer, message.connectionId)) this.#dropConnection(message.connectionId, socket.id);
      return;
    }
    if (message.type === "slack-delivery-result") {
      const pending = this.#pendingDeliveries.get(message.requestId);
      if (!pending || pending.socketId !== socket.id) {
        this.#fail(socket, "permission_denied", "The delivery does not belong to this peer.");
        return;
      }
      this.#settleDelivery(message.requestId, {
        status: message.status,
        ...(message.contentType && message.body !== undefined
          ? { contentType: message.contentType, body: message.body }
          : {}),
      });
      return;
    }
    const connection = this.#connections.get(message.connectionId);
    if (!connection || (connection.client.id !== socket.id && connection.host.id !== socket.id)) {
      this.#fail(socket, "permission_denied", "The connection does not belong to this peer.");
      return;
    }
    const target = connection.client.id === socket.id ? connection.host : connection.client;
    this.#send(target, message);
    this.#metrics.relayedMessages += 1;
  }

  disconnect(socket: SignalSocket): void {
    this.#sockets.delete(socket.id);
    const peer = this.#peers.get(socket.id);
    this.#clearPeerExpiration(socket.id);
    if (!peer) {
      this.#metrics.activeSockets = this.#sockets.size;
      return;
    }
    this.#peers.delete(socket.id);
    if (peer.peer === "host") {
      const hostSockets = this.#hosts.get(peer.claims.hostId);
      hostSockets?.delete(socket.id);
      if (hostSockets?.size === 0) this.#hosts.delete(peer.claims.hostId);
    }
    if (peer.peer === "ingress") {
      for (const route of peer.slackDefaults) {
        if (this.#slackDefaults.get(route) === socket.id) {
          this.#slackDefaults.delete(route);
          this.#slackLegacyDefaults.delete(route);
          this.#slackRoutedUsers.delete(route);
        }
      }
      for (const route of peer.slackPeople) {
        if (this.#slackPeople.get(route) === socket.id) this.#slackPeople.delete(route);
      }
      for (const [requestId, pending] of [...this.#pendingDeliveries]) {
        if (pending.socketId === socket.id) this.#settleDelivery(requestId, this.#unavailable());
      }
    }
    for (const connection of [...this.#connections.values()]) {
      if (connection.client.id !== socket.id && connection.host.id !== socket.id) continue;
      if (connection.client.id === socket.id) {
        this.#scheduleConnectionDrop(connection);
        continue;
      }
      this.#clearConnectionDrop(connection.id);
      this.#connections.delete(connection.id);
      const clientPeer = this.#peers.get(connection.client.id);
      if (clientPeer) clientPeer.connectionId = null;
    }
    if (peer.peer === "host") {
      const replacement = this.#currentHost(peer.claims.hostId);
      if (replacement) void this.#restoreWaitingClients(replacement);
    }
    this.#metrics.activePeerConnections = this.#connections.size;
    this.#metrics.activeSockets = this.#sockets.size;
  }

  profileChanged(userId: string): void {
    this.#notifyAccount(userId, "account-profile-changed");
  }

  /**
   * A membership this account accepted or lost. Every socket the account holds is told, because
   * the device that made the change is not the one that needs to hear about it: the desktop and
   * the phone signed in to one account each keep their own server list.
   */
  serversChanged(userId: string): void {
    this.#notifyAccount(userId, "account-servers-changed");
  }

  #notifyAccount(userId: string, type: "account-profile-changed" | "account-servers-changed"): void {
    for (const peer of this.#peers.values()) {
      if (peer.claims.userId === userId) this.#send(peer.socket, { type, version: 1 });
    }
  }

  revoke(hostId: string, authEpoch: number): void {
    const current = this.#revokedEpochs.get(hostId) ?? 0;
    if (authEpoch <= current) return;
    this.#revokedEpochs.set(hostId, authEpoch);
    this.#tokens.revokeHost?.(hostId, authEpoch);
    for (const connection of [...this.#connections.values()]) {
      const host = this.#peers.get(connection.host.id);
      if (connection.hostId === hostId && host && host.claims.authEpoch < authEpoch) {
        this.#dropConnection(connection.id, connection.client.id);
      }
    }
    for (const peer of [...this.#peers.values()]) {
      if (peer.claims.hostId !== hostId || peer.claims.authEpoch >= authEpoch) continue;
      if (peer.connectionId) this.#dropConnection(peer.connectionId, peer.socket.id);
      this.#fail(peer.socket, "session_revoked", "Remote access was revoked.", 1008);
    }
  }

  /**
   * The account service unlinked a Slack workspace's default computer, or moved it, after
   * `through`'s link. People's own routes stay.
   */
  revokeSlackRoute(appId: string, teamId: string, through: number): void {
    const route = slackRouteKey(appId, teamId);
    if (this.#revokeSlackRouteKey(this.#slackDefaults, route, through)) {
      this.#slackLegacyDefaults.delete(route);
      this.#slackRoutedUsers.delete(route);
    }
  }

  /** The account service unlinked one person of a Slack workspace from their host, or moved them. */
  revokeSlackPersonRoute(appId: string, teamId: string, userId: string, through: number): void {
    const route = slackPersonKey(appId, teamId, userId);
    if (!this.#revokeSlackRouteKey(this.#slackPeople, route, through)) return;
    this.#slackKnownPeople.delete(route);
    this.#slackRoutedUsers.get(slackRouteKey(appId, teamId))?.delete(userId);
  }

  /** Returns true when the route was revoked, false when a newer link already holds it. */
  #revokeSlackRouteKey(routes: Map<string, string>, route: string, through: number): boolean {
    const floor = this.#slackRouteFloor.get(route) ?? 0;
    if (floor > through) return false;
    this.#slackRouteFloor.set(route, through + 1);
    routes.delete(route);
    return true;
  }

  /**
   * The `ingress` sockets that one Slack target names, without repeats; empty when no host holds it.
   * `people` resolves to the person routes of `users`, the people Slack lists for the event.
   */
  slackSockets(appId: string, teamId: string, target: SlackTarget, users: readonly string[] = []): string[] {
    const sockets = new Set<string>();
    const add = (socketId: string | undefined) => {
      if (socketId && this.#peers.has(socketId)) sockets.add(socketId);
    };
    const addPeople = (userIds: readonly string[]) => {
      for (const userId of userIds) add(this.#slackPeople.get(slackPersonKey(appId, teamId, userId)));
    };
    if (target.kind === "default") add(this.#slackDefaults.get(slackRouteKey(appId, teamId)));
    else if (target.kind === "person") addPeople([target.userId]);
    else if (target.kind === "people") addPeople(users);
    else if (target.kind === "persons") addPeople(target.userIds);
    else {
      add(this.#slackDefaults.get(slackRouteKey(appId, teamId)));
      const prefix = slackPersonKey(appId, teamId, "");
      for (const [route, socketId] of this.#slackPeople) if (route.startsWith(prefix)) add(socketId);
    }
    return [...sockets];
  }

  revokeSession(sessionId: string): void {
    this.#revokedSessions.set(sessionId, Math.floor(Date.now() / 1_000) + 24 * 60 * 60);
    this.#tokens.revokeSession?.(sessionId);
    for (const connection of [...this.#connections.values()]) {
      if (connection.sessionId === sessionId) this.#dropConnection(connection.id, connection.client.id);
    }
    for (const peer of [...this.#peers.values()]) {
      if (peer.peer === "client" && peer.claims.sessionId === sessionId) {
        if (peer.connectionId) this.#dropConnection(peer.connectionId, peer.socket.id);
        this.#fail(peer.socket, "session_revoked", "The remote session ended.", 1008);
      }
    }
  }

  /**
   * Passes one signed Slack request to the `ingress` sockets that the routing targets name, in
   * parallel, and waits for their answers. It resolves 503 when a target that must answer has no
   * host, Slack's list of who may see the event is not available, or a host is too busy, refuses or
   * does not answer in time: Slack then sends the request again to every host, and hosts drop the
   * repeat by `event_id`. Nothing needs to be kept here.
   */
  async deliverSlack(
    appId: string,
    teamId: string,
    targets: readonly SlackTarget[],
    delivery: SlackTargetedDelivery,
    authorizations?: SlackAudienceLookup,
  ): Promise<SlackDeliveryResponse> {
    let fanOut: SlackFanOut | null;
    try {
      fanOut = await this.#slackFanOut(appId, teamId, targets, delivery.eventId, authorizations);
    } catch {
      return this.#unavailable();
    }
    if (!fanOut) return this.#unavailable();
    // Nobody with a host may see the event, so there is nothing to deliver.
    if (fanOut.sockets.length === 0) return { status: 200 };
    const responses = await Promise.all(
      fanOut.sockets.map((socketId) => this.#deliverToSocket(socketId, teamId, delivery)),
    );
    const failed = responses.find((response) => response.status !== 200);
    if (failed) return failed;
    if (responses.length === 1) return responses[0] ?? { status: 200 };
    // Only one host can answer Slack with a body: the default, when it was a target.
    const defaultIndex = fanOut.defaultSocket ? fanOut.sockets.indexOf(fanOut.defaultSocket) : -1;
    return responses[defaultIndex] ?? { status: 200 };
  }

  /**
   * The sockets that receive one request, or null when a target that must answer has no host.
   * Rules 1 and 2 (only `person` and `default` targets) take the first target with a host. The other
   * targets are used whole: `people` asks Slack who may see the event.
   */
  async #slackFanOut(
    appId: string,
    teamId: string,
    targets: readonly SlackTarget[],
    eventId: string | null,
    authorizations: SlackAudienceLookup | undefined,
  ): Promise<SlackFanOut | null> {
    const defaultSocket = this.slackSockets(appId, teamId, { kind: "default" })[0] ?? null;
    // A person with an own route is answered only by their own host: when it is offline, the
    // request waits for it (null) and does not fall back to the default.
    const firstHeld = (candidates: readonly SlackTarget[]) => {
      for (const candidate of candidates) {
        const sockets = this.slackSockets(appId, teamId, candidate);
        if (sockets.length > 0) return sockets;
        if (candidate.kind === "person" && this.#hasOwnRoute(appId, teamId, candidate.userId)) return null;
      }
      return null;
    };
    if (targets.every((target) => target.kind === "person" || target.kind === "default")) {
      if (targets.length === 0) return { sockets: [], defaultSocket };
      const sockets = firstHeld(targets);
      return sockets ? { sockets, defaultSocket } : null;
    }
    const sockets = new Set<string>();
    for (const target of targets) {
      if (target.kind === "people") {
        if (!authorizations) return null;
        const audience = await authorizations.usersFor(appId, eventId ?? target.eventContext, target.eventContext);
        if (audience.includesBot && target.directAuthor) {
          // A DM with @GoAhead: rule 1 for its author.
          const held = firstHeld([{ kind: "person", userId: target.directAuthor }, { kind: "default" }]);
          if (!held) return null;
          for (const socketId of held) sockets.add(socketId);
        } else {
          for (const socketId of this.slackSockets(appId, teamId, target, audience.users)) sockets.add(socketId);
          if (defaultSocket && this.#legacyDefaultServes(appId, teamId, audience.users)) sockets.add(defaultSocket);
        }
      } else {
        const held = this.slackSockets(appId, teamId, target);
        // A workspace event with no host at all waits for one, as before multi-user Slack.
        if (target.kind === "all" && held.length === 0) return null;
        for (const socketId of held) sockets.add(socketId);
      }
    }
    return { sockets: [...sockets], defaultSocket };
  }

  /**
   * A default route from a host made before multi-user Slack also stands for each listed person who
   * has no own route in the workspace. The check does not use live sockets, so the message of a
   * person whose own host is offline does not go to the legacy host.
   */
  #legacyDefaultServes(appId: string, teamId: string, users: readonly string[]): boolean {
    if (!this.#slackLegacyDefaults.has(slackRouteKey(appId, teamId))) return false;
    return users.some((userId) => !this.#hasOwnRoute(appId, teamId, userId));
  }

  /**
   * True when the person has an own route in the workspace: a host registered it and it was not
   * revoked since, or the default's ticket lists the person. Such a person is never answered by the
   * default.
   */
  #hasOwnRoute(appId: string, teamId: string, userId: string): boolean {
    if (this.#slackKnownPeople.has(slackPersonKey(appId, teamId, userId))) return true;
    return this.#slackRoutedUsers.get(slackRouteKey(appId, teamId))?.has(userId) === true;
  }

  /** Sends one request to one `ingress` socket and waits for its answer, within the host's limits. */
  #deliverToSocket(socketId: string, teamId: string, delivery: SlackDelivery): Promise<SlackDeliveryResponse> {
    const ingress = this.#peers.get(socketId);
    if (!ingress) return Promise.resolve(this.#unavailable());
    const hostId = ingress.claims.hostId;
    let hostPending = 0;
    let hostBytes = 0;
    for (const pending of this.#pendingDeliveries.values()) {
      if (pending.hostId !== hostId) continue;
      hostPending += 1;
      hostBytes += pending.bytes;
    }
    const bytes = Math.ceil(delivery.body.byteLength / 3) * 4;
    if (
      this.#pendingDeliveries.size >= this.#slackLimits.maximumPending ||
      hostPending >= this.#slackLimits.maximumPendingPerHost ||
      hostBytes + bytes > this.#slackLimits.maximumPendingBytesPerHost
    ) {
      return Promise.resolve(this.#unavailable());
    }
    const requestId = randomIdentifier();
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.#settleDelivery(requestId, this.#unavailable()),
        this.#slackLimits.timeoutMilliseconds,
      );
      timer.unref?.();
      this.#pendingDeliveries.set(requestId, { socketId: ingress.socket.id, hostId, bytes, timer, resolve });
      this.#metrics.slackDeliveries += 1;
      this.#send(ingress.socket, {
        type: "slack-delivery",
        version: 1,
        requestId,
        teamId,
        kind: delivery.kind,
        retryNum: delivery.retryNum,
        retryReason: delivery.retryReason,
        bodyBase64: Buffer.from(delivery.body).toString("base64"),
      });
    });
  }

  /**
   * The rate limit for the Slack route: by workspace for a signed request, by address for a refused
   * one. A signed request is never limited by address, because Slack sends every app's events from
   * shared addresses.
   */
  acceptSlackRequest(key: `team:${string}` | `address:${string}`): boolean {
    return this.#acceptRateKey(`slack-${key}`, Date.now(), key.startsWith("team:") ? SLACK_TEAM_RATE_FACTOR : 1);
  }

  /**
   * A route goes to the socket with the newest link that is not older than the route's floor.
   * Returns true when this socket now holds the route.
   */
  #holdSlackRoute(routes: Map<string, string>, route: string, linkedAt: number, socketId: string): boolean {
    if (linkedAt < (this.#slackRouteFloor.get(route) ?? 0)) return false;
    this.#slackRouteFloor.set(route, linkedAt);
    routes.set(route, socketId);
    return true;
  }

  #settleDelivery(requestId: string, response: SlackDeliveryResponse): void {
    const pending = this.#pendingDeliveries.get(requestId);
    if (!pending) return;
    this.#pendingDeliveries.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  #unavailable(): SlackDeliveryResponse {
    this.#metrics.slackDeliveriesUnavailable += 1;
    return UNAVAILABLE;
  }

  metrics(): SignalMetrics {
    this.#pruneReplayCache();
    return { ...this.#metrics, activeSockets: this.#sockets.size, activePeerConnections: this.#connections.size };
  }

  async #authenticate(socket: SignalSocket, message: Extract<SignalClientMessage, { type: "hello" }>): Promise<void> {
    if (this.#peers.has(socket.id)) {
      this.#fail(socket, "protocol_error", "This socket is already authenticated.", 1008);
      return;
    }
    let claims: RemoteTicketClaims;
    let usedInitialTicket = true;
    let slackRoute: SlackRoute = { teams: [] };
    try {
      try {
        claims = await this.#tokens.verifyTicket(message.token);
        if (Date.now() < this.#validateInitialTicketsUntil && !(await this.#tokens.validateClaims(claims))) {
          throw new Error("The remote session is not active.");
        }
      } catch {
        usedInitialTicket = false;
        claims = await this.#tokens.verifyResumeToken(message.token);
      }
      if ((this.#revokedEpochs.get(claims.hostId) ?? 0) > claims.authEpoch) {
        throw new Error("Revoked ticket.");
      }
      if (claims.role !== "host" && this.#revokedSessions.has(claims.sessionId)) throw new Error("Ended session.");
      if (message.peer !== "client" && claims.role !== "host") throw new Error("Host role required.");
      if (message.peer === "client" && claims.role === "host") throw new Error("Member role required.");
      if (message.peer === "ingress") {
        if (!message.slackRoute || !this.#tokens.verifySlackRoute) throw new Error("Slack route required.");
        slackRoute = await this.#tokens.verifySlackRoute(message.slackRoute, claims.hostId);
        if (Date.now() < this.#validateSlackRoutesUntil) {
          if (!this.#tokens.validateSlackRoute) throw new Error("Slack route validation required.");
          const validation = await this.#tokens.validateSlackRoute(claims.hostId, slackRoute.teams);
          slackRoute = { teams: confirmedSlackRoutes(slackRoute.teams, validation) };
        }
      }
      this.#pruneReplayCache();
      if (usedInitialTicket && this.#usedTicketIds.has(claims.jti)) throw new Error("Ticket was already used.");
      // A reconnect of the same logical session replaces its old socket below, so that socket does not
      // count. A phone that changes network keeps a half-open socket until the idle timeout.
      const replaced =
        message.peer === "client" ? this.#connectionForSession(claims.hostId, claims.sessionId)?.client.id : undefined;
      if (
        message.peer !== "ingress" &&
        this.#userConnectionCount(claims.userId, replaced) >= this.#maximumConnectionsPerUser
      ) {
        this.#fail(socket, "rate_limited", "Too many active remote connections.", 1008);
        return;
      }
    } catch {
      this.#metrics.authenticationFailures += 1;
      this.#fail(socket, "authentication_required", "Remote ticket is invalid or expired.", 1008);
      return;
    }
    // The socket can close while the ticket is verified. `disconnect` then finds no peer, so it
    // cannot clear the peer, its timer and the host event this method creates. Return before it
    // creates them. Nothing awaits between here and the registrations below, so the socket cannot
    // close again first.
    if (!this.#sockets.has(socket.id)) return;
    if (usedInitialTicket) this.#usedTicketIds.set(claims.jti, claims.exp);
    const peer: AuthenticatedPeer = {
      socket,
      claims,
      peer: message.peer,
      connectionId: null,
      resumed: !usedInitialTicket,
      multiplex: message.peer === "host" && message.multiplex === true,
      slackDefaults: slackRoute.teams
        .filter((team) => isDefaultSlackRoute(team))
        .map((team) => slackRouteKey(team.appId, team.id)),
      slackPeople: slackRoute.teams.flatMap((team) =>
        (team.users ?? []).map((user) => slackPersonKey(team.appId, team.id, user.id)),
      ),
    };
    this.#peers.set(socket.id, peer);
    this.#schedulePeerExpiration(peer);
    this.#metrics.acceptedConnections += 1;
    this.#metrics.activeSockets = this.#sockets.size;
    const resumeToken = await this.#tokens.issueResumeToken(claims);
    if (message.peer === "ingress") {
      for (const team of slackRoute.teams) {
        // An entry without `isDefault` comes from a host made before multi-user Slack: it owns the
        // workspace route, as it did then.
        if (isDefaultSlackRoute(team)) {
          const route = slackRouteKey(team.appId, team.id);
          if (this.#holdSlackRoute(this.#slackDefaults, route, team.linkedAt, socket.id)) {
            if (team.isDefault === undefined) this.#slackLegacyDefaults.add(route);
            else this.#slackLegacyDefaults.delete(route);
            this.#slackRoutedUsers.set(route, new Set(team.routedUsers ?? []));
          }
        }
        for (const user of team.users ?? []) {
          const route = slackPersonKey(team.appId, team.id, user.id);
          if (this.#holdSlackRoute(this.#slackPeople, route, user.linkedAt, socket.id))
            this.#slackKnownPeople.add(route);
        }
      }
      this.#send(socket, {
        type: "ready",
        version: 1,
        connectionId: null,
        resumeToken,
        iceServers: this.#tokens.iceServers(claims),
      });
      return;
    }
    if (message.peer === "host") {
      const hostSockets = this.#hosts.get(claims.hostId) ?? new Set<string>();
      hostSockets.add(socket.id);
      this.#hosts.set(claims.hostId, hostSockets);
      this.#send(socket, {
        type: "ready",
        version: 1,
        connectionId: null,
        resumeToken,
        iceServers: this.#tokens.iceServers(claims),
      });
      await this.#restoreWaitingClients(peer);
      return;
    }
    const host = this.#currentHost(claims.hostId);
    if (!host) {
      this.#peers.delete(socket.id);
      this.#metrics.activeSockets = this.#sockets.size;
      this.#fail(socket, "host_unavailable", "The host is offline.", 1013);
      return;
    }
    // A desktop serves multiple devices. Only a reconnect of the SAME logical
    // session replaces a socket; other sessions must retain their connections.
    const existing = this.#connectionForSession(claims.hostId, claims.sessionId);
    if (
      !host.multiplex &&
      [...this.#connections.values()].some(
        (connection) => connection.hostId === claims.hostId && connection !== existing,
      )
    ) {
      this.#peers.delete(socket.id);
      this.#clearPeerExpiration(socket.id);
      this.#fail(socket, "host_busy", "The host already has an active remote session.", 1013);
      return;
    }
    if (existing) this.#replaceClientSignal(existing);
    const connectionId = randomIdentifier();
    peer.connectionId = connectionId;
    this.#connections.set(connectionId, {
      id: connectionId,
      hostId: claims.hostId,
      sessionId: claims.sessionId,
      client: socket,
      host: host.socket,
    });
    this.#metrics.activePeerConnections = this.#connections.size;
    this.#send(socket, {
      type: "ready",
      version: 1,
      connectionId,
      resumeToken,
      iceServers: this.#tokens.iceServers(claims),
    });
    this.#send(host.socket, {
      type: "peer-ready",
      version: 1,
      connectionId,
      sessionId: claims.sessionId,
      userId: claims.userId,
      membershipId: claims.membershipId,
      role: memberRole(claims.role),
      sessionExpiresAt: claims.sessionExpiresAt,
      resumed: peer.resumed,
    });
  }

  /**
   * The host socket that said hello last. A host that stops with no close, such as a hosted server
   * that its provider stops, keeps its old socket until the idle timeout. Its new socket is the one
   * that answers.
   */
  #currentHost(hostId: string): AuthenticatedPeer | null {
    let current: AuthenticatedPeer | null = null;
    for (const socketId of this.#hosts.get(hostId) ?? []) current = this.#peers.get(socketId) ?? current;
    return current;
  }

  #connectionForSession(hostId: string, sessionId: string): ActiveConnection | null {
    for (const connection of this.#connections.values()) {
      if (connection.hostId === hostId && connection.sessionId === sessionId) return connection;
    }
    return null;
  }

  async #restoreWaitingClients(host: AuthenticatedPeer): Promise<void> {
    const clients = [...this.#peers.values()].filter(
      (peer) => peer.peer === "client" && peer.claims.hostId === host.claims.hostId && peer.connectionId === null,
    );
    for (const client of clients) {
      if (
        !host.multiplex &&
        [...this.#connections.values()].some((connection) => connection.hostId === host.claims.hostId)
      )
        return;
      const resumeToken = await this.#tokens.issueResumeToken(client.claims);
      if (this.#peers.get(host.socket.id) !== host) return;
      if (this.#peers.get(client.socket.id) !== client || client.connectionId !== null) continue;
      const connectionId = randomIdentifier();
      client.connectionId = connectionId;
      this.#connections.set(connectionId, {
        id: connectionId,
        hostId: host.claims.hostId,
        sessionId: client.claims.sessionId,
        client: client.socket,
        host: host.socket,
      });
      this.#metrics.activePeerConnections = this.#connections.size;
      this.#send(client.socket, {
        type: "ready",
        version: 1,
        connectionId,
        resumeToken,
        iceServers: this.#tokens.iceServers(client.claims),
      });
      this.#send(host.socket, {
        type: "peer-ready",
        version: 1,
        connectionId,
        sessionId: client.claims.sessionId,
        userId: client.claims.userId,
        membershipId: client.claims.membershipId,
        role: memberRole(client.claims.role),
        sessionExpiresAt: client.claims.sessionExpiresAt,
        resumed: host.resumed || client.resumed,
      });
    }
  }

  #replaceClientSignal(connection: ActiveConnection): void {
    this.#clearConnectionDrop(connection.id);
    this.#connections.delete(connection.id);
    const previous = this.#peers.get(connection.client.id);
    if (previous) {
      this.#peers.delete(connection.client.id);
      this.#clearPeerExpiration(connection.client.id);
      previous.socket.close(4000, "Remote session resumed");
    }
  }

  #dropConnection(connectionId: string, sourceSocketId: string): void {
    const connection = this.#connections.get(connectionId);
    if (!connection) return;
    this.#clearConnectionDrop(connectionId);
    this.#connections.delete(connectionId);
    const target = connection.client.id === sourceSocketId ? connection.host : connection.client;
    this.#send(target, { type: "disconnect", version: 1, connectionId });
    const clientPeer = this.#peers.get(connection.client.id);
    if (clientPeer) clientPeer.connectionId = null;
    this.#metrics.activePeerConnections = this.#connections.size;
  }

  #schedulePeerExpiration(peer: AuthenticatedPeer): void {
    this.#clearPeerExpiration(peer.socket.id);
    const remaining = peer.claims.sessionExpiresAt * 1_000 - Date.now();
    if (remaining <= 0) {
      this.#fail(peer.socket, "authentication_required", "The remote session expired.", 1008);
      return;
    }
    const timer = setTimeout(
      () => {
        this.#peerExpirationTimers.delete(peer.socket.id);
        if (this.#peers.get(peer.socket.id) !== peer) return;
        if (peer.claims.sessionExpiresAt * 1_000 > Date.now()) {
          this.#schedulePeerExpiration(peer);
          return;
        }
        this.#fail(peer.socket, "authentication_required", "The remote session expired.", 1008);
      },
      Math.min(remaining, MAXIMUM_EXPIRATION_TIMER_MILLISECONDS),
    );
    timer.unref?.();
    this.#peerExpirationTimers.set(peer.socket.id, timer);
  }

  #clearPeerExpiration(socketId: string): void {
    const timer = this.#peerExpirationTimers.get(socketId);
    if (timer) clearTimeout(timer);
    this.#peerExpirationTimers.delete(socketId);
  }

  #scheduleConnectionDrop(connection: ActiveConnection): void {
    this.#clearConnectionDrop(connection.id);
    const timer = setTimeout(
      () => this.#dropConnection(connection.id, connection.client.id),
      SIGNAL_RECONNECT_GRACE_MILLISECONDS,
    );
    timer.unref?.();
    this.#connectionDropTimers.set(connection.id, timer);
  }

  #clearConnectionDrop(connectionId: string): void {
    const timer = this.#connectionDropTimers.get(connectionId);
    if (timer) clearTimeout(timer);
    this.#connectionDropTimers.delete(connectionId);
  }

  #ownsConnection(peer: AuthenticatedPeer, connectionId: string): boolean {
    const connection = this.#connections.get(connectionId);
    return Boolean(connection && (connection.client.id === peer.socket.id || connection.host.id === peer.socket.id));
  }

  #userConnectionCount(userId: string, exceptSocketId?: string): number {
    let total = 0;
    for (const peer of this.#peers.values()) {
      if (peer.peer !== "ingress" && peer.claims.userId === userId && peer.socket.id !== exceptSocketId) total += 1;
    }
    return total;
  }

  #socketIpCount(ip: string): number {
    let total = 0;
    for (const socket of this.#sockets.values()) if (socket.ip === ip) total += 1;
    return total;
  }

  #acceptMessage(socket: SignalSocket, now = Date.now()): boolean {
    const peer = this.#peers.get(socket.id);
    // An ingress socket answers the Slack requests of every workspace linked to its host, so it has a bucket of
    // its own rather than a share of the account's and the address's. It can only answer requests
    // Signal sent it, and the delivery limits bound those.
    if (peer?.peer === "ingress") return this.#acceptRateKey(`ingress:${socket.id}`, now, INGRESS_RATE_FACTOR);
    if (!this.#acceptRateKey(`ip:${socket.ip || socket.id}`, now)) return false;
    return peer ? this.#acceptRateKey(`user:${peer.claims.userId}`, now) : true;
  }

  #acceptRateKey(key: string, now: number, factor = 1): boolean {
    this.#pruneRateWindows(now);
    const current = this.#rateWindows.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MILLISECONDS) {
      if (!current && this.#rateWindows.size >= MAXIMUM_RATE_WINDOWS) {
        const oldestKey = this.#rateWindows.keys().next().value;
        if (oldestKey) this.#rateWindows.delete(oldestKey);
      }
      if (current) this.#rateWindows.delete(key);
      this.#rateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.#maximumMessagesPerMinute * factor;
  }

  #pruneReplayCache(nowSeconds = Math.floor(Date.now() / 1_000)): void {
    for (const [jti, expiresAt] of this.#usedTicketIds) if (expiresAt <= nowSeconds) this.#usedTicketIds.delete(jti);
    for (const [sessionId, expiresAt] of this.#revokedSessions) {
      if (expiresAt <= nowSeconds) this.#revokedSessions.delete(sessionId);
    }
  }

  #pruneRateWindows(now: number): void {
    if (now - this.#lastRatePruneAt < RATE_WINDOW_MILLISECONDS) return;
    this.#lastRatePruneAt = now;
    for (const [key, window] of this.#rateWindows) {
      if (now - window.startedAt >= RATE_WINDOW_MILLISECONDS) this.#rateWindows.delete(key);
    }
  }

  #send(socket: SignalSocket, message: SignalServerMessage): void {
    socket.send(encodeSignalServerMessage(message));
  }

  #fail(socket: SignalSocket, code: SignalErrorCode, message: string, closeCode?: number): void {
    this.#send(socket, { type: "error", version: 1, code, message });
    if (closeCode) socket.close(closeCode, message);
  }
}

function memberRole(role: RemoteTicketClaims["role"]): "owner" | "admin" | "member" {
  if (role === "host") throw new Error("A host cannot create a client connection.");
  return role;
}

function randomIdentifier(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** One Slack app in one workspace. The production and development apps can share a workspace. */
function slackRouteKey(appId: string, teamId: string): string {
  return `${appId}:${teamId}`;
}

function slackPersonKey(appId: string, teamId: string, userId: string): string {
  return `${appId}:${teamId}:${userId}`;
}

/**
 * The parts of a ticket's entries that the account service confirmed. Signal takes no more than the
 * signed ticket names: `routes` can only remove a default link or people from an entry. An answer
 * without `routes` comes from an account service made before multi-user Slack, which confirms only
 * workspace links; the people of such an entry are then not taken.
 */
function confirmedSlackRoutes(teams: SlackRouteTeam[], validation: SlackRouteValidation): SlackRouteTeam[] {
  if (!validation.routes) {
    const linked = new Set(validation.teams);
    return teams
      .filter((team) => linked.has(team.id))
      .map((team) => ({
        id: team.id,
        appId: team.appId,
        linkedAt: team.linkedAt,
        ...(team.isDefault === undefined ? {} : { isDefault: team.isDefault }),
        ...(team.routedUsers && isDefaultSlackRoute(team) ? { routedUsers: team.routedUsers } : {}),
      }));
  }
  const confirmed = new Map(validation.routes.map((route) => [slackRouteKey(route.appId, route.id), route]));
  const result: SlackRouteTeam[] = [];
  for (const team of teams) {
    const route = confirmed.get(slackRouteKey(team.appId, team.id));
    if (!route || route.linkedAt !== team.linkedAt) continue;
    const confirmedUsers = new Set((route.users ?? []).map((user) => `${user.id}:${user.linkedAt}`));
    const users = (team.users ?? []).filter((user) => confirmedUsers.has(`${user.id}:${user.linkedAt}`));
    const isDefault = isDefaultSlackRoute(team) && isDefaultSlackRoute(route);
    if (!isDefault && users.length === 0) continue;
    // An entry without `isDefault` keeps that form, so that Signal still knows it as a legacy route.
    result.push({
      id: team.id,
      appId: team.appId,
      linkedAt: team.linkedAt,
      ...(isDefault && team.isDefault === undefined ? {} : { isDefault }),
      users,
      // Signed data: the default link holds, so its list of routed people stands too.
      ...(isDefault && team.routedUsers ? { routedUsers: team.routedUsers } : {}),
    });
  }
  return result;
}
