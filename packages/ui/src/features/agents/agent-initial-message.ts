import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import { appLanguageOption } from "@openbot/i18n/languages";
import { currentText } from "../../text";

/**
 * The first message of a new agent. A host with `agent-welcome-v1` gets the welcome setup message.
 * Other hosts (GoAhead v0.40/v0.41) get "Greet me briefly.", as GoAhead v0.41 sends. The role goes
 * only in the instructions (`description`), never in this message.
 */
export function createAgentInitialMessage(welcomeSupported: boolean): string {
  const text = currentText();
  if (welcomeSupported) return agentWelcomeMessage({ language: appLanguageOption(text.locale()).label });
  return text.t("agent.setup.firstGreeting");
}
