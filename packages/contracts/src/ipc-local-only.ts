// What must not leave the computer that runs the agents: the Team API, other members, the phone.
// A `google-mail-notice` note holds mail data; only this desktop shows it. A local-only approval
// (`local-only:` request id, such as a mail to send) holds private text, and only the person at this
// computer answers it.

import type { AgentEvent } from "./ipc-agent-events";
import type { AgentRuntimeSnapshot } from "./ipc-agent-runtime";
import { isLocalOnlyApprovalRequestId, LOCAL_ONLY_APPROVAL_PREFIX } from "./ipc-approvals";
import type { ConversationMessage } from "./ipc-conversation-messages";
import { GOOGLE_MAIL_NOTICE_ITEM_TYPE } from "./ipc-google-connector";

/**
 * Every conversation item type that stays on this computer. The one list: the message filters here
 * and the SQL filters of the database (`localOnlyItemTypeSqlFilter`) are built from it.
 */
export const LOCAL_ONLY_CONVERSATION_ITEM_TYPES: readonly string[] = [GOOGLE_MAIL_NOTICE_ITEM_TYPE];

export function isLocalOnlyConversationMessage(message: Pick<ConversationMessage, "itemType">): boolean {
  return message.itemType !== undefined && LOCAL_ONLY_CONVERSATION_ITEM_TYPES.includes(message.itemType);
}

/** The messages that another client may see. `references` is filtered the same way. */
export function sharedConversationMessages<Content extends { messages: ConversationMessage[] }>(
  content: Content,
): Content {
  const messages = content.messages.filter((message) => !isLocalOnlyConversationMessage(message));
  return messages.length === content.messages.length ? content : { ...content, messages };
}

/** The key prefix of a Google send or booking card. The request id is `local-only:` and the key. */
export const GOOGLE_APPROVAL_KEY_PREFIX = "google:";

export type LocalOnlyApprovalKind = "send" | "meeting";

/** The key of a Google card: its kind and the approval id of the Google state file. */
export function googleApprovalKey(kind: LocalOnlyApprovalKind, approvalId: string): string {
  return `${GOOGLE_APPROVAL_KEY_PREFIX}${kind}:${approvalId}`;
}

/** What a local-only approval asks for, from its request id, or null for any other approval. */
export function localOnlyApprovalKind(requestId: string | number): LocalOnlyApprovalKind | null {
  if (!isLocalOnlyApprovalRequestId(requestId)) return null;
  const key = String(requestId).slice(LOCAL_ONLY_APPROVAL_PREFIX.length);
  if (key.startsWith(googleApprovalKey("send", ""))) return "send";
  if (key.startsWith(googleApprovalKey("meeting", ""))) return "meeting";
  return null;
}

/** The snapshot that another client may see: no local-only approval. */
export function sharedRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): AgentRuntimeSnapshot {
  const pendingApprovals = snapshot.pendingApprovals.filter(
    (approval) => !isLocalOnlyApprovalRequestId(approval.requestId),
  );
  return pendingApprovals.length === snapshot.pendingApprovals.length ? snapshot : { ...snapshot, pendingApprovals };
}

/** The event as another client may see it, or null when it must not leave this computer. */
export function sharedAgentEvent(event: AgentEvent): AgentEvent | null {
  if (event.type === "approval" && isLocalOnlyApprovalRequestId(event.approval.requestId)) return null;
  if (event.type === "agent-input-resolved" && isLocalOnlyApprovalRequestId(event.requestId)) return null;
  if (event.type === "runtime-snapshot") {
    const snapshot = sharedRuntimeSnapshot(event.snapshot);
    return snapshot === event.snapshot ? event : { ...event, snapshot };
  }
  if (event.type === "conversation") {
    const snapshot = sharedConversationMessages(event.snapshot);
    return snapshot === event.snapshot ? event : { ...event, snapshot };
  }
  if (event.type === "conversation-page") {
    const page = sharedConversationMessages(event.page);
    const references = Object.entries(page.references);
    const sharedReferences = references.filter(([, message]) => !isLocalOnlyConversationMessage(message));
    if (page === event.page && sharedReferences.length === references.length) return event;
    return { ...event, page: { ...page, references: Object.fromEntries(sharedReferences) } };
  }
  return event;
}
