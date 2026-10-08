import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const insertPerson = (database: DatabaseSync, slackUserId: string) =>
  database
    .prepare(
      `INSERT INTO slack_person_routes(team_id, slack_user_id, host_id, account_id, connected_at)
       VALUES ('T1', ?, 'host-1', 'user-1', 2)`,
    )
    .run(slackUserId);

describe("slack person routes migration", () => {
  it("keeps the workspace route, keys people by team and Slack user, and follows the host", () => {
    const database = migratedDatabase("0025_slack_workspace_routes.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'user-1', 'Desk', 1, 1);
      INSERT INTO slack_workspace_routes(team_id, host_id, account_id, app_id, bot_user_id, connected_at)
      VALUES ('T1', 'host-1', 'user-1', 'A1', 'UBOT', 1);
    `);
    const before = database.prepare("SELECT * FROM slack_workspace_routes").all();

    database.exec("BEGIN");
    database.exec(migration("0026_slack_person_routes.sql"));
    database.exec("COMMIT");

    expect(database.prepare("SELECT * FROM slack_workspace_routes").all()).toEqual(before);
    insertPerson(database, "U1");
    insertPerson(database, "U2");
    expect(() => insertPerson(database, "U1")).toThrow(/UNIQUE/);

    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-1'");
    expect(database.prepare("SELECT * FROM slack_person_routes").all()).toEqual([]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});
