import type { AgentHandoff, AgentHandoffStep } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Button, ChevronDown, CircleCheck, Clock3, LoaderCircle, TriangleAlert } from "@openbot/ui";
import { Dynamic } from "@solidjs/web";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

export interface HandoffCardProps {
  handoff: AgentHandoff;
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
}

/**
 * Work that this agent gave to a teammate: who it went to, the task, how far the teammate is, and
 * the answer when it is done. The step list opens on request.
 */
export function HandoffCard(props: HandoffCardProps) {
  const { t } = useText();
  const [expanded, setExpanded] = createSignal(false);
  const stepsId = createUniqueId();
  const agentName = (agentId: string) =>
    props.agents.find((agent) => agent.id === agentId)?.name ?? t("chat.marker.unavailableAgent");
  const from = () => agentName(props.handoff.fromAgentId);
  const to = () => agentName(props.handoff.toAgentId);
  const recipient = () => props.agents.find((agent) => agent.id === props.handoff.toAgentId);
  const status = () => handoffStatusText(props.handoff, t);
  return (
    <article
      class="handoff-card conversation-interaction-card"
      aria-label={t("chat.handoff.accessible", { from: from(), to: to(), status: status() })}
      data-status={props.handoff.status}
    >
      <header class="handoff-card-header">
        <Button
          variant="ghost"
          size="xs"
          type="button"
          class="handoff-card-agent"
          onClick={() => props.onSelectAgent(props.handoff.toAgentId)}
        >
          <AgentAvatar agent={recipient()} class="chat-action-agent-avatar" />
          <span>{t("chat.handoff.title", { from: from(), to: to() })}</span>
        </Button>
        <span class="handoff-card-status">
          <Dynamic component={statusIcon(props.handoff.status)} aria-hidden="true" />
          <span>{status()}</span>
        </span>
      </header>
      <p class="handoff-card-task">{props.handoff.task}</p>
      <Show when={props.handoff.reply}>
        {(reply) => (
          <div class="handoff-card-reply">
            <span class="handoff-card-reply-label">{t("chat.handoff.reply", { name: to() })}</span>
            <p class="handoff-card-reply-text">{reply()}</p>
          </div>
        )}
      </Show>
      <Show when={props.handoff.steps.length > 0}>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          class="handoff-card-steps-toggle"
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={stepsId}
          onClick={() => setExpanded(!expanded())}
        >
          <ChevronDown aria-hidden="true" />
          {t(expanded() ? "chat.handoff.hideSteps" : "chat.handoff.showSteps", {
            count: props.handoff.steps.length,
          })}
        </Button>
        <Show when={expanded()}>
          <ol id={stepsId} class="handoff-card-steps" aria-label={t("chat.handoff.steps")}>
            <For each={props.handoff.steps}>{(step) => <li>{stepText(step, t)}</li>}</For>
          </ol>
        </Show>
      </Show>
    </article>
  );
}

function statusIcon(status: AgentHandoff["status"]) {
  if (status === "done") return CircleCheck;
  if (status === "failed") return TriangleAlert;
  if (status === "queued") return Clock3;
  return LoaderCircle;
}

/** The status line: the newest step while the teammate works. */
export function handoffStatusText(handoff: AgentHandoff, t: AppTranslate): string {
  if (handoff.status === "queued") return t("chat.handoff.queued");
  if (handoff.status === "done") return t("chat.handoff.done");
  if (handoff.status === "failed") return t("chat.handoff.failed");
  const step = handoff.steps.at(-1);
  if (!step) return t("chat.handoff.thinking");
  switch (step.kind) {
    case "command":
      return t("chat.handoff.running", { name: step.name });
    case "edit":
      return t("chat.handoff.editing", { name: step.name });
    case "search":
      return t("chat.handoff.searching");
    default:
      return t("chat.handoff.using", { name: step.name });
  }
}

function stepText(step: AgentHandoffStep, t: AppTranslate): string {
  switch (step.kind) {
    case "command":
      return t("chat.handoff.stepRunning", { name: step.name });
    case "edit":
      return t("chat.handoff.stepEditing", { name: step.name });
    case "search":
      return t("chat.handoff.stepSearching");
    default:
      return t("chat.handoff.stepUsing", { name: step.name });
  }
}
