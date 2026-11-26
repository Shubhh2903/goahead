import { describe, expect, it } from "vitest";
import { textFor } from "../../../shared/lib/text-value";
import { connectionPathLabel } from "./connection-path-label";

const { t } = textFor("en");

describe("connection path label", () => {
  it("names the path of an online server", () => {
    expect(connectionPathLabel({ state: "online", connectionPath: { kind: "direct" } }, t)).toBe("Direct");
    expect(connectionPathLabel({ state: "online", connectionPath: { kind: "relay" } }, t)).toBe("Relay");
  });

  it.each([
    ["signal-unreachable", "Cannot connect: server not reachable"],
    ["no-answer", "Cannot connect: the computer did not answer"],
    ["no-stun", "Cannot connect: no STUN server"],
    ["stun-unreachable", "Cannot connect: STUN server not reachable"],
    ["no-relay", "Cannot connect: no relay. Try the same Wi-Fi."],
    ["no-path", "Cannot connect: no network path found"],
  ] as const)("gives the reason %s for an offline server", (reason, text) => {
    expect(connectionPathLabel({ state: "offline", connectionPath: { kind: "cannot-connect", reason } }, t)).toBe(text);
  });

  it("shows nothing when the path does not describe the state", () => {
    expect(connectionPathLabel({ state: "online" }, t)).toBeNull();
    expect(connectionPathLabel({ state: "connecting", connectionPath: { kind: "direct" } }, t)).toBeNull();
    expect(connectionPathLabel({ state: "offline", connectionPath: { kind: "relay" } }, t)).toBeNull();
    expect(
      connectionPathLabel({ state: "online", connectionPath: { kind: "cannot-connect", reason: "no-path" } }, t),
    ).toBeNull();
  });
});
