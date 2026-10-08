import type { UpdatePhase, UpdateStatus } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { presentAppUpdate } from "./app-update";

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: "available",
    currentVersion: "0.32.0",
    availableVersion: "0.33.0",
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
    ...patch,
  };
}

describe("presentAppUpdate", () => {
  it("offers an available update", () => {
    expect(presentAppUpdate(status())).toEqual({
      updatable: true,
      busy: false,
      failed: false,
      actionLabel: "Update",
      title: "GoAhead update available",
      detail: "v0.32.0 → v0.33.0",
      progress: null,
    });
  });

  it("follows the download with its percentage and no action", () => {
    expect(presentAppUpdate(status({ phase: "downloading", progress: 36.6 }))).toMatchObject({
      busy: true,
      actionLabel: undefined,
      title: "Updating GoAhead",
      detail: "v0.32.0 → v0.33.0",
      progress: 37,
    });
  });

  it("offers a restart for a downloaded update", () => {
    expect(presentAppUpdate(status({ phase: "ready", progress: 100 }))).toMatchObject({
      busy: false,
      failed: false,
      actionLabel: "Restart",
      title: "GoAhead update ready",
    });
  });

  it("offers a retry for a failed download, with its reason", () => {
    expect(
      presentAppUpdate(
        status({ phase: "error", errorCode: "download_failed", message: "Could not download the update. Try again." }),
      ),
    ).toMatchObject({
      failed: true,
      actionLabel: "Retry",
      title: "GoAhead update failed",
      detail: "Could not download the update. Try again.",
    });
  });

  it.each<UpdatePhase>(["idle", "checking", "up-to-date", "unsupported", "installing"])(
    "shows nothing while %s",
    (phase) => {
      expect(presentAppUpdate(status({ phase }))).toBeNull();
    },
  );

  it("shows nothing for a failed check or install, which Settings reports", () => {
    expect(presentAppUpdate(status({ phase: "error", errorCode: "check_failed" }))).toBeNull();
    expect(presentAppUpdate(status({ phase: "error", errorCode: "install_failed" }))).toBeNull();
  });

  it("shows nothing when the host manages updates or a restart already has its own notice", () => {
    expect(presentAppUpdate(status({ managedByHost: true }))).toBeNull();
    expect(
      presentAppUpdate(
        status({ phase: "ready", scheduledRestart: { requestedBy: null, mode: "now", waitingFor: [] } }),
      ),
    ).toBeNull();
    expect(presentAppUpdate(status({ phase: "ready", idleRestart: { target: "update", waitingFor: [] } }))).toBeNull();
  });
});
