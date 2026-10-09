import type { HistoryEvent } from "../messaging-types";
import type { SlackCacheStore } from "./cache-store";

/**
 * Applies one live Slack change to the cache of one workspace. Returns true when the cache may have
 * changed, so the caller tells the open view; false when the event concerns nothing the cache keeps.
 * An edit, a deletion or a reaction on a message that is not cached is left out: the next page
 * read gives Slack's state.
 *
 * A new message counts only in a conversation the cache lists with the person as a member. The bot
 * is in every public channel and Slack sends one event per app, so an event alone does not show that
 * the person is in the channel. The `users.conversations` refresh adds new conversations, DMs too.
 */
export function applySlackClientEvent(store: SlackCacheStore, connectionId: string, event: HistoryEvent): boolean {
  switch (event.type) {
    case "message": {
      const listed = store
        .conversations(connectionId)
        .some((entry) => entry.channelId === event.channelId && entry.isMember);
      if (!listed) return false;
      // A known ts keeps its merged reactions, edit and reply count.
      if (store.thread(connectionId, event.channelId, event.message.ts).parent !== null) return false;
      store.upsertMessage(connectionId, event.channelId, event.message);
      return true;
    }
    case "edited":
      store.markEdited(connectionId, event.channelId, event.ts, event.text, event.editedAt);
      return true;
    case "deleted":
      store.markDeleted(connectionId, event.channelId, event.ts);
      return true;
    case "reaction":
      store.adjustReaction(
        connectionId,
        event.channelId,
        event.ts,
        event.name,
        event.userId,
        event.on,
        event.ownerUserId,
      );
      return true;
    case "membership": {
      const current = store.conversations(connectionId).find((entry) => entry.channelId === event.channelId);
      // A channel the person left and the cache never listed changes nothing.
      if (!current && !event.isMember) return false;
      // A new channel gets its name at the next list refresh.
      store.upsertConversations(connectionId, [
        {
          channelId: event.channelId,
          kind: current?.kind ?? event.kind,
          name: current?.name ?? "",
          memberIds: current?.memberIds ?? [],
          isMember: event.isMember,
        },
      ]);
      return true;
    }
  }
}
