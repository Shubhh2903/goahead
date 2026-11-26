import type { AppSetupState } from "@openbot/contracts/ipc";

/**
 * The first-run wizard: provider sign-in (the onboarding flow), the first agent (the agent form),
 * Slack and Gmail, and the phone QR code. Every step and the whole wizard can be skipped.
 *
 * No state of its own is stored. The wizard starts only when the setup that loaded at launch was
 * not completed, and step one ends with a saved setup, so after a restart it never starts again.
 * The later steps live in memory: a restart in the middle ends the wizard, it does not resume it.
 */
export const FIRST_RUN_STEPS = ["provider", "agent", "connect", "phone"] as const;

export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export type FirstRunWizard =
  | { status: "active"; step: FirstRunStep; skipped: readonly FirstRunStep[] }
  | { status: "finished"; skipped: readonly FirstRunStep[] }
  | { status: "skipped" };

export type ActiveFirstRunWizard = Extract<FirstRunWizard, { status: "active" }>;

export function startFirstRunWizard(): FirstRunWizard {
  return { status: "active", step: "provider", skipped: [] };
}

/**
 * The wizard for the setup read at launch, or null when it never shows. A completed setup is an
 * existing user: the old onboarding is done, so no stored wizard key is needed to know it.
 */
export function firstRunWizardForSetup(setup: Pick<AppSetupState, "completed"> | null): FirstRunWizard | null {
  return setup?.completed === true ? null : startFirstRunWizard();
}

export function isFirstRunActive(wizard: FirstRunWizard | null): wizard is ActiveFirstRunWizard {
  return wizard?.status === "active";
}

export function nextFirstRunStep(wizard: FirstRunWizard): FirstRunWizard {
  if (wizard.status !== "active") return wizard;
  const following = FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(wizard.step) + 1];
  return following
    ? { status: "active", step: following, skipped: wizard.skipped }
    : { status: "finished", skipped: wizard.skipped };
}

/** One step back. A step the user returns to is no longer skipped. */
export function previousFirstRunStep(wizard: FirstRunWizard): FirstRunWizard {
  if (wizard.status !== "active") return wizard;
  const previous = FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(wizard.step) - 1];
  if (!previous) return wizard;
  return { status: "active", step: previous, skipped: wizard.skipped.filter((step) => step !== previous) };
}

export function skipFirstRunStep(wizard: FirstRunWizard): FirstRunWizard {
  if (wizard.status !== "active") return wizard;
  return nextFirstRunStep({ ...wizard, skipped: [...wizard.skipped, wizard.step] });
}

export function skipFirstRunWizard(wizard: FirstRunWizard): FirstRunWizard {
  return wizard.status === "active" ? { status: "skipped" } : wizard;
}

export function finishFirstRunWizard(wizard: FirstRunWizard): FirstRunWizard {
  return wizard.status === "active" ? { status: "finished", skipped: wizard.skipped } : wizard;
}

/**
 * Whether the user skipped the first agent, alone or with the whole wizard. The agent form then
 * does not open by itself on an empty roster for the rest of the session.
 */
export function firstAgentSkipped(wizard: FirstRunWizard | null): boolean {
  if (!wizard) return false;
  return wizard.status === "skipped" || wizard.skipped.includes("agent");
}

/**
 * What the agent step does with the roster it sees. Agents that the user did not submit in this
 * step belong to an existing profile (for example one whose setup file was lost), so the wizard is
 * done. An agent after a submit is the one the user just made, and the next step follows.
 */
export function agentStepOutcome(input: { agentCount: number; submitted: boolean }): "wait" | "advance" | "done" {
  if (input.agentCount === 0) return "wait";
  return input.submitted ? "advance" : "done";
}
