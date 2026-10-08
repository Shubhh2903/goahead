import { describe, expect, it, vi } from "vitest";
import { SlackAuthorizations, type SlackAuthorizationsFetch } from "../src/slack-authorizations";

const APP_TOKEN = "xapp-1-A1-secret-value";
const AUTHORIZATIONS_URL = "https://slack.com/api/apps.event.authorizations.list";

function authorization(userId: string, isBot = false) {
  return { enterprise_id: null, team_id: "T1", user_id: userId, is_bot: isBot, is_enterprise_install: false };
}

describe("SlackAuthorizations", () => {
  it("posts the event context with the app token and follows the cursor", async () => {
    const fetch = vi
      .fn<SlackAuthorizationsFetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          authorizations: [authorization("U1"), authorization("UBOT", true)],
          response_metadata: { next_cursor: "next-1" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ ok: true, authorizations: [authorization("U2")], response_metadata: { next_cursor: "" } }),
      );
    const client = new SlackAuthorizations({ appToken: (appId) => (appId === "A1" ? APP_TOKEN : null), fetch });

    await expect(client.usersFor("A1", "Ev1", "4-ctx")).resolves.toEqual({ users: ["U1", "U2"], includesBot: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] ?? ["", {}];
    expect(url).toBe(AUTHORIZATIONS_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${APP_TOKEN}`);
    expect(new URLSearchParams(String(init.body)).get("event_context")).toBe("4-ctx");
    expect(new URLSearchParams(String(fetch.mock.calls[1]?.[1].body)).get("cursor")).toBe("next-1");
  });

  it("reports no bot when Slack's list has only people", async () => {
    const fetch = vi
      .fn<SlackAuthorizationsFetch>()
      .mockResolvedValue(Response.json({ ok: true, authorizations: [authorization("U1"), authorization("U2")] }));
    const client = new SlackAuthorizations({ appToken: () => APP_TOKEN, fetch });
    await expect(client.usersFor("A1", "Ev1", "4-ctx")).resolves.toEqual({ users: ["U1", "U2"], includesBot: false });
  });

  it("returns the cached result for the same event without a second fetch", async () => {
    const fetch = vi
      .fn<SlackAuthorizationsFetch>()
      .mockImplementation(async () => Response.json({ ok: true, authorizations: [authorization("U1")] }));
    const client = new SlackAuthorizations({ appToken: () => APP_TOKEN, fetch });
    const first = await client.usersFor("A1", "Ev1", "4-ctx");
    await expect(client.usersFor("A1", "Ev1", "4-ctx")).resolves.toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.usersFor("A1", "Ev2", "4-ctx");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on a Slack error without the token in the message, and does not cache it", async () => {
    const fetch = vi
      .fn<SlackAuthorizationsFetch>()
      .mockResolvedValueOnce(Response.json({ ok: false, error: "invalid_auth" }))
      .mockResolvedValueOnce(Response.json({ ok: true, authorizations: [authorization("U1")] }));
    const client = new SlackAuthorizations({ appToken: () => APP_TOKEN, fetch });
    const message = await failureMessage(client.usersFor("A1", "Ev1", "4-ctx"));
    expect(message).toContain("invalid_auth");
    expect(message).not.toContain(APP_TOKEN);
    await expect(client.usersFor("A1", "Ev1", "4-ctx")).resolves.toEqual({ users: ["U1"], includesBot: false });
  });

  it("throws on an HTTP failure without the token in the message", async () => {
    const fetch = vi.fn<SlackAuthorizationsFetch>().mockResolvedValue(new Response(APP_TOKEN, { status: 500 }));
    const client = new SlackAuthorizations({ appToken: () => APP_TOKEN, fetch });
    const message = await failureMessage(client.usersFor("A1", "Ev1", "4-ctx"));
    expect(message).not.toContain(APP_TOKEN);
  });

  it("throws when the app has no app token", async () => {
    const fetch = vi.fn<SlackAuthorizationsFetch>();
    const client = new SlackAuthorizations({ appToken: () => null, fetch });
    await expect(client.usersFor("A2", "Ev1", "4-ctx")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

async function failureMessage(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error("Expected the call to fail");
  return error.message;
}
