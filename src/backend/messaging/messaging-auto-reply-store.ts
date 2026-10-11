import { databaseRows } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/**
 * Owns `projection_messaging_auto_reply`: the conversations where the connected person lets an
 * agent's message go out as them with no approval. Off is the absence of a row, so a conversation
 * nobody switched on needs approval. Rows hold ids only. It never imports the database facade's
 * callers.
 */
export class MessagingAutoReplyStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  isOn(connectionId: string, platformChannelId: string): boolean {
    return (
      databaseRows(
        this.#database.connection
          .prepare(
            "SELECT 1 FROM projection_messaging_auto_reply WHERE connection_id = ? AND platform_channel_id = ? LIMIT 1",
          )
          .all(connectionId, platformChannelId),
      ).length > 0
    );
  }

  /** Whether any conversation of the connection is on the list. */
  hasAny(connectionId: string): boolean {
    return (
      databaseRows(
        this.#database.connection
          .prepare("SELECT 1 FROM projection_messaging_auto_reply WHERE connection_id = ? LIMIT 1")
          .all(connectionId),
      ).length > 0
    );
  }

  set(connectionId: string, platformChannelId: string, on: boolean): void {
    if (on)
      this.#database.connection
        .prepare(
          `INSERT INTO projection_messaging_auto_reply (connection_id, platform_channel_id, created_at)
           VALUES (?, ?, ?) ON CONFLICT(connection_id, platform_channel_id) DO NOTHING`,
        )
        .run(connectionId, platformChannelId, new Date().toISOString());
    else
      this.#database.connection
        .prepare("DELETE FROM projection_messaging_auto_reply WHERE connection_id = ? AND platform_channel_id = ?")
        .run(connectionId, platformChannelId);
  }

  /** A disconnect empties the list: a later connect, maybe as another person, starts with approval everywhere. */
  clearConnection(connectionId: string): void {
    this.#database.connection
      .prepare("DELETE FROM projection_messaging_auto_reply WHERE connection_id = ?")
      .run(connectionId);
  }
}
