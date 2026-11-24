import type { RoutineRunCondition } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

export const RUN_CONDITION_PLACEHOLDER = "{value}";

export type RunConditionTemplateId = "new-commit" | "new-file" | "page-changed" | "file-exists";

export interface RunConditionTemplate {
  id: RunConditionTemplateId;
  labelKey: AppTextKey;
  /** Asked for when the command has a placeholder. */
  askKey?: AppTextKey;
  command: string;
  when: RoutineRunCondition["when"];
}

export const RUN_CONDITION_TEMPLATES: readonly RunConditionTemplate[] = [
  {
    id: "new-commit",
    labelKey: "routine.settings.runConditionTemplate.newCommit",
    command: "git log -1 --format=%H",
    when: "output-changes",
  },
  {
    id: "new-file",
    labelKey: "routine.settings.runConditionTemplate.newFile",
    askKey: "routine.settings.runConditionTemplate.askFolder",
    command: `ls -t ${RUN_CONDITION_PLACEHOLDER} | head -1`,
    when: "output-changes",
  },
  {
    id: "page-changed",
    labelKey: "routine.settings.runConditionTemplate.pageChanged",
    askKey: "routine.settings.runConditionTemplate.askUrl",
    command: `curl -fsSL ${RUN_CONDITION_PLACEHOLDER} | shasum`,
    when: "output-changes",
  },
  {
    id: "file-exists",
    labelKey: "routine.settings.runConditionTemplate.fileExists",
    askKey: "routine.settings.runConditionTemplate.askPath",
    command: `test -f ${RUN_CONDITION_PLACEHOLDER}`,
    when: "exit-zero",
  },
];

/** Quote one value for a POSIX shell: single quotes, with each embedded quote written as '\''. */
export function shellQuote(value: string): string {
  // The shell does not expand ~ inside quotes, so write a leading ~ or ~/ as "$HOME" outside them.
  if (value === "~") return '"$HOME"';
  if (value.startsWith("~/")) {
    const rest = value.slice(2);
    return rest ? `"$HOME"/${shellQuote(rest)}` : '"$HOME"/';
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Fill a template. A template with a placeholder needs a non-empty value; otherwise this returns null. */
export function fillRunConditionTemplate(template: RunConditionTemplate, value = ""): RoutineRunCondition | null {
  if (!template.command.includes(RUN_CONDITION_PLACEHOLDER)) return { command: template.command, when: template.when };
  const trimmed = value.trim();
  if (!trimmed) return null;
  return {
    command: template.command.replaceAll(RUN_CONDITION_PLACEHOLDER, () => shellQuote(trimmed)),
    when: template.when,
  };
}
