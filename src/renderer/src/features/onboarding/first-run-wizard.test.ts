import { describe, expect, it } from "vitest";
import {
  agentStepOutcome,
  finishFirstRunWizard,
  firstAgentSkipped,
  firstRunWizardForSetup,
  nextFirstRunStep,
  previousFirstRunStep,
  skipFirstRunStep,
  skipFirstRunWizard,
  startFirstRunWizard,
} from "./first-run-wizard";

describe("first-run wizard", () => {
  it("moves through every step and finishes after the last", () => {
    let wizard = startFirstRunWizard();
    expect(wizard).toEqual({ status: "active", step: "provider", skipped: [] });
    wizard = nextFirstRunStep(wizard);
    expect(wizard).toEqual({ status: "active", step: "agent", skipped: [] });
    wizard = nextFirstRunStep(nextFirstRunStep(wizard));
    expect(wizard).toEqual({ status: "active", step: "phone", skipped: [] });
    expect(nextFirstRunStep(wizard)).toEqual({ status: "finished", skipped: [] });
  });

  it("goes back one step and stays on the first step", () => {
    const phone = nextFirstRunStep(nextFirstRunStep(nextFirstRunStep(startFirstRunWizard())));
    expect(previousFirstRunStep(phone)).toEqual({ status: "active", step: "connect", skipped: [] });
    expect(previousFirstRunStep(startFirstRunWizard())).toEqual(startFirstRunWizard());
  });

  it("records a skipped step and forgets it when the user goes back to it", () => {
    const connect = nextFirstRunStep(nextFirstRunStep(startFirstRunWizard()));
    const phone = skipFirstRunStep(connect);
    expect(phone).toEqual({ status: "active", step: "phone", skipped: ["connect"] });
    expect(previousFirstRunStep(phone)).toEqual({ status: "active", step: "connect", skipped: [] });
    expect(skipFirstRunStep(phone)).toEqual({ status: "finished", skipped: ["connect", "phone"] });
  });

  it("skips the whole wizard from any step, and a closed wizard does not change", () => {
    const agent = nextFirstRunStep(startFirstRunWizard());
    const skipped = skipFirstRunWizard(agent);
    expect(skipped).toEqual({ status: "skipped" });
    expect(nextFirstRunStep(skipped)).toBe(skipped);
    expect(previousFirstRunStep(skipped)).toBe(skipped);
    expect(skipFirstRunStep(skipped)).toBe(skipped);
    expect(finishFirstRunWizard(skipped)).toBe(skipped);
  });

  it("finishes from any step and keeps the skipped steps", () => {
    const phone = skipFirstRunStep(nextFirstRunStep(nextFirstRunStep(startFirstRunWizard())));
    const finished = finishFirstRunWizard(phone);
    expect(finished).toEqual({ status: "finished", skipped: ["connect"] });
    expect(skipFirstRunWizard(finished)).toBe(finished);
  });

  it("starts only for a profile whose setup was not completed at launch", () => {
    expect(firstRunWizardForSetup(null)).toEqual(startFirstRunWizard());
    expect(firstRunWizardForSetup({ completed: false })).toEqual(startFirstRunWizard());
    // The old onboarding is done: an existing user never sees the wizard, with no stored key.
    expect(firstRunWizardForSetup({ completed: true })).toBeNull();
  });

  it("knows when the first agent was skipped, alone or with the whole wizard", () => {
    const agent = nextFirstRunStep(startFirstRunWizard());
    expect(firstAgentSkipped(null)).toBe(false);
    expect(firstAgentSkipped(agent)).toBe(false);
    expect(firstAgentSkipped(skipFirstRunStep(agent))).toBe(true);
    expect(firstAgentSkipped(skipFirstRunWizard(startFirstRunWizard()))).toBe(true);
    expect(firstAgentSkipped(finishFirstRunWizard(nextFirstRunStep(agent)))).toBe(false);
  });

  it("ends the agent step as done for a profile that already has agents", () => {
    expect(agentStepOutcome({ agentCount: 0, submitted: false })).toBe("wait");
    expect(agentStepOutcome({ agentCount: 0, submitted: true })).toBe("wait");
    // The roster has agents that the user did not make in this step: an existing profile.
    expect(agentStepOutcome({ agentCount: 2, submitted: false })).toBe("done");
    // The user submitted the form, and now there is an agent: the next step follows.
    expect(agentStepOutcome({ agentCount: 1, submitted: true })).toBe("advance");
  });
});
