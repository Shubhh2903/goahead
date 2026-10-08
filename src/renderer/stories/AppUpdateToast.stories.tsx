import type { UpdateStatus } from "@openbot/contracts/ipc";
import { Toaster } from "@openbot/ui";
import { createSignal, onCleanup, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createAppUpdateToast, dismissAppUpdateToast } from "../src/features/updates/app-update-toast";

const OFFER: UpdateStatus = {
  phase: "available",
  currentVersion: "0.32.0",
  availableVersion: "0.33.0",
  progress: null,
  checkedAt: null,
  message: null,
  errorCode: null,
};

/**
 * The update notification of GoAhead itself, as `updates-context.tsx` raises it. Press Update to
 * watch a short download end at Restart. Restart does nothing here.
 */
function AppUpdateToastFlow(props: { status: UpdateStatus }) {
  const [status, setStatus] = createSignal<UpdateStatus>(untrack(() => props.status));
  let timer: number | undefined;
  onCleanup(() => window.clearInterval(timer));

  async function act(): Promise<void> {
    const phase = status().phase;
    if (phase !== "available" && phase !== "error") return;
    setStatus({ ...status(), phase: "downloading", progress: 0, errorCode: null, message: null });
    timer = window.setInterval(() => {
      const progress = Math.min(100, (status().progress ?? 0) + 5);
      if (progress < 100) {
        setStatus({ ...status(), progress });
        return;
      }
      window.clearInterval(timer);
      setStatus({ ...status(), phase: "ready", progress: 100 });
    }, 150);
  }

  dismissAppUpdateToast();
  createAppUpdateToast({ status, act });

  return <Toaster />;
}

const meta = {
  title: "Setup/AppUpdateToast",
  component: AppUpdateToastFlow,
  parameters: { layout: "fullscreen" },
  args: { status: OFFER },
} satisfies Meta<typeof AppUpdateToastFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The offer of a new GoAhead version. */
export const Available: Story = {};

/** The download at 37 percent. */
export const Downloading: Story = {
  args: { status: { ...OFFER, phase: "downloading", progress: 37 } },
};

/** The downloaded update, which restarts GoAhead to install it. */
export const Ready: Story = {
  args: { status: { ...OFFER, phase: "ready", progress: 100 } },
};

/** A failed download, which offers Retry. */
export const DownloadFailed: Story = {
  args: {
    status: {
      ...OFFER,
      phase: "error",
      errorCode: "download_failed",
      message: "Could not download the update. Try again.",
    },
  },
};
