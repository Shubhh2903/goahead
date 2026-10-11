import { describe, expect, it } from "vitest";
import { slackOrchestratorProfile, upgradeSlackOrchestratorDescription } from "./slack-orchestrator";
import { PREVIOUS_SLACK_ORCHESTRATOR_DESCRIPTIONS } from "./slack-orchestrator-history";

const current = slackOrchestratorProfile().description;
const released = PREVIOUS_SLACK_ORCHESTRATOR_DESCRIPTIONS[0] ?? "";

describe("upgradeSlackOrchestratorDescription", () => {
  it("gives every earlier built-in text the current rules", () => {
    for (const previous of PREVIOUS_SLACK_ORCHESTRATOR_DESCRIPTIONS)
      expect(upgradeSlackOrchestratorDescription(previous)).toEqual({ status: "upgraded", description: current });
  });

  it("keeps rules that the person changed", () => {
    const edited = released.replace("Delegate it.", "Do it yourself.");
    expect(upgradeSlackOrchestratorDescription(edited)).toEqual({ status: "edited" });
  });

  it("keeps the person's text before and after the built-in rules", () => {
    const upgrade = upgradeSlackOrchestratorDescription(`Speak French.\n\n${released}\n\nSign as Ana.`);
    expect(upgrade).toEqual({ status: "upgraded", description: `Speak French.\n\n${current}\n\nSign as Ana.` });
  });

  it("changes nothing the second time", () => {
    const once = upgradeSlackOrchestratorDescription(`${released}\n\nSign as Ana.`);
    const description = once.status === "upgraded" ? once.description : "";
    expect(upgradeSlackOrchestratorDescription(description)).toEqual({ status: "current" });
  });
});
