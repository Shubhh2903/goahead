// @vitest-environment node

import type { IdleRestart as IdleRestartStatus, UpdateStatus } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdleRestart } from "./idle-restart";
import type { RestartReadiness } from "./update-readiness";

afterEach(() => {
  vi.useRealTimers();
});

/** An idle restart whose agents stay busy, so only "Restart now" can end the wait. */
function busyRestart() {
  const base: UpdateStatus = {
    phase: "ready",
    currentVersion: "0.40.0",
    availableVersion: "0.41.0",
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
  };
  let status = base;
  const installUpdate = vi.fn(async () => undefined);
  const relaunch = vi.fn();
  const describeReadiness = vi.fn((): RestartReadiness => ({ safeToRestart: false, reasons: ["agent-turn"] }));
  const restart = new IdleRestart({
    updater: {
      getStatus: () => status,
      installUpdate,
      setIdleRestart: (idleRestart: IdleRestartStatus | null) => {
        const { idleRestart: _previous, ...rest } = status;
        status = idleRestart ? { ...rest, idleRestart } : rest;
      },
    },
    describeReadiness,
    holdRoutines: vi.fn(),
    releaseRoutines: vi.fn(),
    recordHold: vi.fn(),
    relaunch,
    log: vi.fn(),
    pollMs: 1_000,
  });
  return {
    restart,
    installUpdate,
    relaunch,
    describeReadiness,
    setPhase: (next: UpdateStatus["phase"]) => {
      status = { ...status, phase: next };
    },
  };
}

describe("IdleRestart", () => {
  it("waits for idle agents until the user chooses Restart now", async () => {
    vi.useFakeTimers();
    const { restart, installUpdate, describeReadiness } = busyRestart();

    restart.request("update");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(describeReadiness).toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();

    restart.restartNow();
    await vi.waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
  });

  it("restarts at once for a relaunch, and does nothing without a waiting restart", () => {
    const { restart, relaunch } = busyRestart();

    restart.restartNow();
    expect(relaunch).not.toHaveBeenCalled();

    restart.request("relaunch");
    restart.restartNow();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("refuses Restart now while the update installs", () => {
    const { restart, installUpdate, setPhase } = busyRestart();
    restart.request("update");
    setPhase("installing");

    expect(() => restart.restartNow()).toThrow();
    expect(installUpdate).not.toHaveBeenCalled();
  });
});
