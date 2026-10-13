import { CLAUDE_WEEKLY_OPUS_LIMIT_ID, CLAUDE_WEEKLY_SONNET_LIMIT_ID } from "@openbot/contracts/ipc";
import { ClaudePlanLimits, claudePlanLimits } from "@openbot/ui/features/usage/ClaudePlanLimits";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

// A fixed clock keeps the reset text the same on each render.
const NOW = Date.UTC(2026, 9, 13, 9, 0);
const inMinutes = (minutes: number) => (NOW + minutes * 60_000) / 1_000;

const meta = {
  title: "Agents/Usage/Claude plan limits",
  component: ClaudePlanLimits,
  args: {
    now: NOW,
    loading: false,
    limits: claudePlanLimits({
      limits: [
        {
          id: "claude",
          primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: inMinutes(135) },
          secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: inMinutes(3 * 1_440 + 300) },
        },
      ],
    }),
  },
  render: (props) => (
    <main style={{ "max-width": "720px", padding: "24px", background: "var(--openbot-bg-canvas)" }}>
      <ClaudePlanLimits {...props} />
    </main>
  ),
} satisfies Meta<typeof ClaudePlanLimits>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PlanLimits: Story = {};

// The account-wide reading: the model family weekly windows come as their own limits.
export const WithModelWeeklyLimits: Story = {
  args: {
    limits: claudePlanLimits({
      limits: [
        {
          id: "claude",
          primary: { usedPercent: 94, windowDurationMins: 300, resetsAt: inMinutes(12) },
          secondary: { usedPercent: 61, windowDurationMins: 10_080, resetsAt: inMinutes(2 * 1_440) },
        },
        {
          id: CLAUDE_WEEKLY_OPUS_LIMIT_ID,
          primary: null,
          secondary: { usedPercent: 77, windowDurationMins: 10_080, resetsAt: inMinutes(2 * 1_440) },
        },
        {
          id: CLAUDE_WEEKLY_SONNET_LIMIT_ID,
          primary: null,
          secondary: { usedPercent: 23, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    }),
  },
};

export const Loading: Story = { args: { limits: null, loading: true } };

export const ApiKeyAccount: Story = { args: { limits: claudePlanLimits({ limits: [] }) } };
