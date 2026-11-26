import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { appLanguageOption } from "@openbot/i18n/languages";
import type { TranslatedLocale } from "@openbot/i18n/mobile";

export type NewAgentInput = Omit<CreateAgentInput, "initialMessage"> & { firstTask?: string };

/**
 * The first message of a new agent. The role goes only in the instructions (`description`), so a
 * role-only agent gets `greeting` ("Greet me briefly."), as GoAhead v0.41 sends.
 */
export function agentInitialMessage(
  task: string,
  welcome: { locale: TranslatedLocale } | null,
  greeting: string,
): string {
  if (welcome)
    return agentWelcomeMessage({
      language: appLanguageOption(welcome.locale).label,
      firstRequestFollows: task.trim().length > 0,
    });
  return task.trim() || greeting;
}
