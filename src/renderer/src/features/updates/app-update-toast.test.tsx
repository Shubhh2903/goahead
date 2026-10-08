import type { UpdateStatus } from "@openbot/contracts/ipc";
import { Toaster } from "@openbot/ui";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { emitUpdateStatus, installOpenbotStub } from "../../app-test-harness";
import { dismissAppUpdateToast } from "./app-update-toast";
import { UpdatesProvider } from "./updates-context";

function status(patch: Partial<UpdateStatus>): UpdateStatus {
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

function emit(patch: Partial<UpdateStatus>): void {
  if (!emitUpdateStatus) throw new Error("The update status bridge has no subscriber.");
  emitUpdateStatus(status(patch));
}

beforeEach(() => {
  installOpenbotStub();
  render(() => (
    <UpdatesProvider>
      <Toaster />
    </UpdatesProvider>
  ));
});

afterEach(() => {
  dismissAppUpdateToast();
});

it("offers the update, follows the download, and restarts from the same notification", async () => {
  await waitFor(() => expect(emitUpdateStatus).toBeDefined());
  emit({ phase: "available" });
  expect(await screen.findByText("GoAhead update available")).toBeInTheDocument();
  expect(screen.getByText("v0.32.0 → v0.33.0")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  await waitFor(() => expect(window.openbot.update.download).toHaveBeenCalled());

  emit({ phase: "downloading", progress: 37 });
  expect(await screen.findByRole("progressbar", { name: "Updating GoAhead" })).toBeInTheDocument();

  emit({ phase: "ready", progress: 100 });
  fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
  await waitFor(() => expect(window.openbot.update.install).toHaveBeenCalled());
});

it("stays closed for the version the user closed, and announces the next one", async () => {
  await waitFor(() => expect(emitUpdateStatus).toBeDefined());
  emit({ phase: "available" });
  expect(await screen.findByText("GoAhead update available")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
  await waitFor(() => expect(screen.queryByText("GoAhead update available")).not.toBeInTheDocument());

  emit({ phase: "ready", progress: 100 });
  expect(screen.queryByText("GoAhead update ready")).not.toBeInTheDocument();

  emit({ phase: "available", availableVersion: "0.34.0" });
  expect(await screen.findByText("v0.32.0 → v0.34.0")).toBeInTheDocument();
});
