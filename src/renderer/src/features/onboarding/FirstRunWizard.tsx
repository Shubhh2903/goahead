import { FirstRunWizardDialog } from "@openbot/ui/features/onboarding/FirstRunWizardDialog";
import { SettingsMobileConnectTab } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { createSettingsMobileConnectStore } from "@openbot/ui/features/settings/stores/mobile-connect-store";
import { useText } from "@openbot/ui/text";
import { createEffect, Match, Switch, untrack } from "solid-js";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { ConnectorsPanel } from "../connectors/ConnectorsPanel";
import type { GoogleConnectorController } from "../connectors/google-connector";
import type { SlackConnectorController } from "../connectors/slack-connector";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import {
  agentStepOutcome,
  FIRST_RUN_STEPS,
  type FirstRunStep,
  finishFirstRunWizard,
  firstAgentSkipped,
  isFirstRunActive,
  nextFirstRunStep,
  previousFirstRunStep,
  skipFirstRunStep,
  skipFirstRunWizard,
} from "./first-run-wizard";
import { useSetup } from "./onboarding-context";

/**
 * The first-run wizard after step one, on this computer only. The agent step is the agent form in
 * the workspace, which this watches; Slack and Gmail, and the phone, are one dialog with the
 * existing panels in it. The connectors are this computer's own controllers, so their sign-in
 * flows are the ones Server settings runs.
 */
export function FirstRunWizard(props: { google: GoogleConnectorController; slack: SlackConnectorController }) {
  const { t } = useText();
  const setup = useSetup();
  const auth = useAuth();
  const { agentList, agentSetupOpen, creatingAgent, skipFirstAgentSetup } = useAgents();
  const { activeServer } = useServers();
  const { serverSettingsOpen } = useServerSettings();
  const { appSettingsOpen } = useSettings();
  const local = () => activeServer()?.kind === "local";
  const step = (): FirstRunStep | null => {
    const wizard = setup.firstRunWizard();
    return isFirstRunActive(wizard) && local() ? wizard.step : null;
  };

  /** The user submitted the agent form during the agent step. Agents without it are not theirs. */
  let agentSubmitted = false;
  createEffect(
    () => ({ step: step(), creating: creatingAgent(), count: agentList().length }),
    ({ step, creating, count }) => {
      if (step !== "agent") return;
      if (creating) agentSubmitted = true;
      const outcome = agentStepOutcome({ agentCount: count, submitted: agentSubmitted });
      if (outcome === "advance") setup.updateFirstRunWizard(nextFirstRunStep);
      else if (outcome === "done") setup.updateFirstRunWizard(finishFirstRunWizard);
    },
  );

  /**
   * A skip of the whole wizard also skips the first agent. The empty roster may have opened the
   * form already, behind the provider step. Once, when the skip happens: the sidebar's new-agent
   * action can open the form again afterwards.
   */
  createEffect(
    () => firstAgentSkipped(setup.firstRunWizard()),
    (skipped) => {
      if (!skipped) return;
      untrack(() => {
        if (local() && agentList().length === 0 && agentSetupOpen()) skipFirstAgentSetup();
      });
    },
  );

  // A Google status read at launch can be stale: the sign-in can change outside this window.
  createEffect(
    () => step() === "connect",
    (shown) => {
      if (shown) untrack(() => props.google.reload());
    },
  );

  const mobileConnect = createSettingsMobileConnectStore(
    {
      get open() {
        return step() === "phone";
      },
      onCreateMobileConnect: auth.createMobileConnect,
      onListMobileConnectedDevices: auth.listMobileConnectedDevices,
      onRevokeMobileConnectedDevice: auth.revokeMobileConnectedDevice,
    },
    () => step() === "phone",
  );

  const dialogStep = () => {
    const current = step();
    return current === "connect" || current === "phone" ? current : null;
  };
  // Settings and the agent form cover the dialog's place; the step waits until they close.
  const open = () => dialogStep() !== null && !serverSettingsOpen() && !appSettingsOpen() && !agentSetupOpen();

  return (
    <FirstRunWizardDialog
      open={open()}
      stepNumber={FIRST_RUN_STEPS.indexOf(dialogStep() ?? "connect") + 1}
      stepCount={FIRST_RUN_STEPS.length}
      title={dialogStep() === "phone" ? t("onboarding.wizard.phone.title") : t("onboarding.wizard.connect.title")}
      description={
        dialogStep() === "phone" ? t("onboarding.wizard.phone.description") : t("onboarding.wizard.connect.description")
      }
      last={dialogStep() === "phone"}
      onBack={dialogStep() === "phone" ? () => setup.updateFirstRunWizard(previousFirstRunStep) : undefined}
      onNext={() => setup.updateFirstRunWizard(nextFirstRunStep)}
      onSkipStep={() => setup.updateFirstRunWizard(skipFirstRunStep)}
      onSkipAll={() => setup.updateFirstRunWizard(skipFirstRunWizard)}
    >
      <Switch>
        <Match when={dialogStep() === "connect"}>
          <ConnectorsPanel
            google={props.google.status().available ? props.google : undefined}
            slack={props.slack}
            agents={agentList()}
          />
        </Match>
        <Match when={dialogStep() === "phone"}>
          <SettingsMobileConnectTab
            store={mobileConnect}
            canCreateTicket={Boolean(auth.createMobileConnect)}
            canRevokeDevice={Boolean(auth.revokeMobileConnectedDevice)}
          />
        </Match>
      </Switch>
    </FirstRunWizardDialog>
  );
}
