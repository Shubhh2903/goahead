import { describe, expect, it } from "vitest";
import {
  createSlackWorkspaceKeyPair,
  openSlackWorkspaceGrant,
  type SlackWorkspaceGrant,
  sealSlackWorkspaceGrant,
} from "./slack-workspace-grant";

const botOnly = {
  botToken: "xoxb-1-secret",
  botUserId: "U1",
  appId: "A1",
  workspaceId: "T1",
  workspaceName: "Acme",
  user: null,
};
const withUser = { ...botOnly, user: { token: "xoxp-1-secret", id: "U2" } };

// The grant carries Slack tokens through a browser. Only the host that asked for it may read it.
describe("Slack workspace grant", () => {
  it("opens only with the host key and the nonce of the sign-in that asked for it", async () => {
    const host = await createSlackWorkspaceKeyPair();
    const other = await createSlackWorkspaceKeyPair();
    const sealed = await sealSlackWorkspaceGrant(host.publicKey, "nonce-1", withUser);

    expect(sealed).not.toContain("xox");
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-1", sealed)).resolves.toEqual(withUser);
    await expect(openSlackWorkspaceGrant(other.privateKey, "nonce-1", sealed)).rejects.toThrow();
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-2", sealed)).rejects.toThrow();
  });

  // A Worker from before the user token, and a new Worker whose install gave no user token, both
  // seal a grant with no `user` key. A host of either age opens it as a bot-only grant.
  it("opens a bot-only grant, and refuses a user part that is not whole", async () => {
    const host = await createSlackWorkspaceKeyPair();
    const sealed = await sealSlackWorkspaceGrant(host.publicKey, "nonce-1", botOnly);
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-1", sealed)).resolves.toEqual(botOnly);

    // A user part with no id, as only a Worker with a bug could write it.
    const halfUser: SlackWorkspaceGrant = JSON.parse(JSON.stringify({ ...botOnly, user: { token: "xoxp-1-secret" } }));
    const broken = await sealSlackWorkspaceGrant(host.publicKey, "nonce-1", halfUser);
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-1", broken)).rejects.toThrow();
  });
});
