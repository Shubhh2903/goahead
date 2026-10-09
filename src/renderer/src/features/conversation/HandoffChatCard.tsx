import type { AgentHandoff } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { HandoffCard } from "@openbot/ui/features/conversation/HandoffCard";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { type HandoffsPort, localHandoffsPort } from "./handoffs-port";

export interface HandoffChatCardProps {
  /** The agent that sent the request: the owner of this conversation. */
  agentId: string;
  /** The mailbox message of the request, as the outgoing marker names it. */
  messageId: string;
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
  /** Drawn until the host names the hand-offs of this message, and when it names none. */
  fallback: JSX.Element;
  port?: HandoffsPort;
}

/**
 * The cards of a request this agent sent to teammates: one per recipient, with the live status and
 * the answer. A request the host does not report, such as an old one, keeps its plain marker.
 */
export function HandoffChatCard(props: HandoffChatCardProps) {
  const [handoffs, setHandoffs] = createSignal<AgentHandoff[]>([]);
  const port = () => props.port ?? localHandoffsPort;
  onSettled(() => {
    let active = true;
    // A slower answer must not replace a newer one.
    let request = 0;
    const load = () => {
      const current = ++request;
      port()
        .list(props.agentId)
        .then((list) => {
          if (active && current === request)
            setHandoffs(list.filter((handoff) => handoff.messageId === props.messageId));
        })
        .catch(() => undefined);
    };
    const unsubscribe = port().subscribe(props.agentId, load);
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  });
  return (
    <Show when={handoffs().length > 0} fallback={props.fallback}>
      <div class="handoff-card-list">
        <For each={handoffs()} keyed={(handoff) => handoff.id}>
          {(handoff) => <HandoffCard handoff={handoff()} agents={props.agents} onSelectAgent={props.onSelectAgent} />}
        </For>
      </div>
    </Show>
  );
}
