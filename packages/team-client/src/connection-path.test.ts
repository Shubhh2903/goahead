import { describe, expect, it } from "vitest";
import {
  type ConnectionFailureFacts,
  type ConnectionFailureReason,
  connectionFailureReason,
  connectionPathFromCandidates,
  iceServerUrls,
} from "./connection-path";

describe("connection path from the selected candidate pair", () => {
  const direct = ["host", "srflx", "prflx"];
  it.each(direct.flatMap((local) => direct.map((remote) => [local, remote])))("%s -> %s is direct", (local, remote) => {
    expect(connectionPathFromCandidates(local, remote)).toEqual({ kind: "direct" });
  });

  it.each([
    ["relay", "host"],
    ["srflx", "relay"],
    ["relay", "relay"],
    ["relay", undefined],
  ])("%s -> %s is a relay", (local, remote) => {
    expect(connectionPathFromCandidates(local, remote)).toEqual({ kind: "relay" });
  });

  it.each([
    [undefined, undefined],
    ["host", undefined],
    ["host", "unknown"],
  ])("%s -> %s gives no status", (local, remote) => {
    expect(connectionPathFromCandidates(local, remote)).toBeNull();
  });
});

describe("connection failure reason", () => {
  const facts: ConnectionFailureFacts = {
    signalWasReady: true,
    hostAnswered: true,
    iceServerUrls: ["stun:s", "turn:t"],
    gatheredServerReflexive: false,
    stunCandidateError: false,
  };
  it.each([
    ["signal never ready", { signalWasReady: false }, "signal-unreachable"],
    ["no STUN URL", { iceServerUrls: ["turn:t"] }, "no-stun"],
    ["host never answered", { hostAnswered: false }, "no-answer"],
    ["host never answered and no STUN", { hostAnswered: false, iceServerUrls: ["turn:t"] }, "no-answer"],
    ["STUN error and no reflexive candidate", { stunCandidateError: true }, "stun-unreachable"],
    ["no reflexive candidate and no STUN error (pruned srflx)", { iceServerUrls: ["stun:s"] }, "no-relay"],
    [
      "STUN error but a reflexive candidate exists",
      { stunCandidateError: true, gatheredServerReflexive: true },
      "no-path",
    ],
    ["no TURN URL", { iceServerUrls: ["stun:s", "stuns:s"] }, "no-relay"],
    ["TURN listed", {}, "no-path"],
    ["TURN over TLS counts as TURN", { iceServerUrls: ["stun:s", "turns:t"] }, "no-path"],
  ] satisfies [string, Partial<ConnectionFailureFacts>, ConnectionFailureReason][])("%s", (_name, change, reason) => {
    expect(connectionFailureReason({ ...facts, ...change })).toBe(reason);
  });

  it("reads urls given as a string or a list", () => {
    expect(iceServerUrls([{ urls: "stun:a" }, { urls: ["turn:b", "turns:c"] }])).toEqual([
      "stun:a",
      "turn:b",
      "turns:c",
    ]);
  });
});
