import type { AgentModelId, AgentProviderId, AppSetupState } from "@openbot/contracts/ipc";
import { errorReference } from "@openbot/user-errors";
import { createSignal, createStore, onSettled } from "solid-js";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { firstRunTransition } from "./first-run-transition";
import { type FirstRunWizard, firstRunWizardForSetup, nextFirstRunStep } from "./first-run-wizard";
import { onboardingPort } from "./onboarding-port";

export type OnboardingJourney = Pick<DesktopAnalyticsProperties<"onboarding_completed">, "path" | "skipped">;

interface SetupRead {
  loaded: boolean;
  failed: boolean;
  retrying: boolean;
  reference: string | null;
}

const Setup = createSimpleContext({
  name: "Setup",
  init: () => {
    const [setupState, setSetupState] = createSignal<AppSetupState | null>(null);
    const [read, setRead] = createStore<SetupRead>({ loaded: false, failed: false, retrying: false, reference: null });
    const [pendingInviteUrl, setPendingInviteUrl] = createSignal("");
    /**
     * The first-run wizard of this session, or null when it never shows. It is decided once, from
     * the first setup read that answers: see `first-run-wizard.ts` for why nothing else is stored.
     */
    const [firstRunWizard, setFirstRunWizard] = createSignal<FirstRunWizard | null>(null);
    let firstRunWizardDecided = false;

    function decideFirstRunWizard(state: AppSetupState | null): void {
      if (firstRunWizardDecided) return;
      firstRunWizardDecided = true;
      setFirstRunWizard(firstRunWizardForSetup(state));
    }

    async function readSetupState(): Promise<void> {
      try {
        const state = await onboardingPort().getSetupState();
        decideFirstRunWizard(state);
        setSetupState(state);
        setRead((current) => {
          current.loaded = true;
          current.failed = false;
          current.reference = null;
        });
      } catch (error) {
        setRead((current) => {
          current.loaded = true;
          current.failed = true;
          current.reference = errorReference(error);
        });
      }
    }

    onSettled(() => {
      void readSetupState();
      return onboardingPort().onSetupState(setSetupState);
    });

    async function retrySetupRead(): Promise<void> {
      if (read.retrying) return;
      setRead((current) => {
        current.retrying = true;
      });
      await readSetupState();
      setRead((current) => {
        current.retrying = false;
      });
    }

    function setUpAgain(): void {
      decideFirstRunWizard(null);
      setRead((current) => {
        current.failed = false;
        current.reference = null;
      });
    }

    function keptModel(preferredProvider: AgentProviderId): AgentModelId | null {
      const previous = setupState();
      if (!previous || previous.preferredProvider !== preferredProvider) return null;
      return previous.preferredModel ?? null;
    }

    async function saveSetup(
      preferredProvider: AgentProviderId,
      preferredModel?: AgentModelId | null,
      journey: OnboardingJourney = {},
    ) {
      const wasCompleted = setupState()?.completed === true;
      const analytics = desktopAnalytics.scope();
      const state = await onboardingPort().saveSetup({
        preferredProvider,
        preferredModel: preferredModel === undefined ? keptModel(preferredProvider) : preferredModel,
      });
      if (!wasCompleted && state.completed) {
        await firstRunTransition("open", () => {
          setSetupState(state);
        });
        analytics.track("onboarding_completed", { preferred_provider: preferredProvider, ...journey });
      } else {
        setSetupState(state);
      }
    }

    /** Step one of the wizard ends: the first-run flow saved its choice, and the agent step follows. */
    async function saveFirstRunSetup(
      preferredProvider: AgentProviderId,
      preferredModel: AgentModelId | null,
      journey: OnboardingJourney,
    ) {
      await saveSetup(preferredProvider, preferredModel, journey);
      updateFirstRunWizard(nextFirstRunStep);
    }

    function updateFirstRunWizard(transform: (wizard: FirstRunWizard) => FirstRunWizard): void {
      setFirstRunWizard((current) => (current ? transform(current) : current));
    }

    async function previewInvite(input: { inviteUrl: string }) {
      return onboardingPort().servers.previewInvite(input);
    }

    return {
      setupState,
      setupLoaded: () => read.loaded,
      setupReadFailed: () => read.failed,
      setupReadRetrying: () => read.retrying,
      setupReadReference: () => read.reference,
      retrySetupRead,
      setUpAgain,
      pendingInviteUrl,
      setPendingInviteUrl,
      saveSetup,
      firstRunWizard,
      saveFirstRunSetup,
      updateFirstRunWizard,
      previewInvite,
    };
  },
});

export const SetupProvider = Setup.provider;
export const useSetup = Setup.use;
