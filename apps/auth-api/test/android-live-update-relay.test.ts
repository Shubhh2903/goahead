import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { FcmLiveUpdateSender, readAndroidLiveUpdateRelayPush } from "../src/server/android-live-update-relay";

const token = `${"d".repeat(22)}:APA91b${"x".repeat(120)}`;
const body = {
  machineToken: "machine",
  token,
  event: "update",
  sealed: "c2VhbGVk",
  timestamp: 1_790_000_000,
  staleAt: 1_790_000_900,
  priority: "high",
};

async function sender(respond: () => Response) {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const fetch = vi.fn(async (input: string, _init: RequestInit) =>
    input.startsWith("https://oauth2.googleapis.com/")
      ? Response.json({ access_token: "access-1", expires_in: 3600 })
      : respond(),
  );
  const fcm = new FcmLiveUpdateSender(
    {
      projectId: "goahead-app",
      clientEmail: "relay@goahead-app.iam.gserviceaccount.com",
      privateKey: await exportPKCS8(privateKey),
    },
    fetch,
  );
  return { fcm, fetch };
}

describe("Android live update relay", () => {
  it("sends the sealed props as a data message with no notification text of its own", async () => {
    const { fcm, fetch } = await sender(() => Response.json({ name: "projects/goahead-app/messages/1" }));
    const push = readAndroidLiveUpdateRelayPush({ ...body, notification: { title: "Pay now" } });
    if (!push) throw new Error("The update was not read.");

    expect(await fcm.send(push)).toBe("sent");
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/goahead-app/messages:send");
    expect(init?.headers).toMatchObject({ authorization: "Bearer access-1" });
    expect(JSON.parse(String(init?.body))).toEqual({
      message: {
        token,
        data: {
          kind: "goahead-live-update",
          event: "update",
          sealed: body.sealed,
          timestamp: String(body.timestamp),
          staleAt: String(body.staleAt),
        },
        android: { priority: "HIGH", ttl: "900s", collapse_key: "goahead-live-update" },
      },
    });

    // The access token is used again until it is near its end.
    await fcm.send(push);
    expect(fetch.mock.calls.filter(([input]) => input.startsWith("https://oauth2.googleapis.com/"))).toHaveLength(1);
  });

  it("refuses a token or sealed value that could carry other content", () => {
    expect(readAndroidLiveUpdateRelayPush({ ...body, token: "../../messages:send" })).toBeNull();
    expect(readAndroidLiveUpdateRelayPush({ ...body, sealed: '","notification":"x' })).toBeNull();
    expect(readAndroidLiveUpdateRelayPush({ ...body, sealed: "a".repeat(4_000) })).toBeNull();
    expect(readAndroidLiveUpdateRelayPush({ ...body, priority: 10 })).toBeNull();
    expect(readAndroidLiveUpdateRelayPush({ ...body, event: "end", sealed: null, staleAt: null })).not.toBeNull();
  });

  it("tells the host when FCM no longer knows the token, so it stops sending", async () => {
    const push = readAndroidLiveUpdateRelayPush(body);
    if (!push) throw new Error("The update was not read.");

    const gone = await sender(() =>
      Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }),
    );
    expect(await gone.fcm.send(push)).toBe("gone");
    const otherProject = await sender(() =>
      Response.json(
        { error: { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] } },
        { status: 403 },
      ),
    );
    expect(await otherProject.fcm.send(push)).toBe("gone");
    const busy = await sender(() => new Response(null, { status: 503 }));
    expect(await busy.fcm.send(push)).toBe("unavailable");
    const invalid = await sender(() =>
      Response.json(
        { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "INVALID_ARGUMENT" }] } },
        { status: 400 },
      ),
    );
    expect(await invalid.fcm.send(push)).toBe("rejected");
  });
});
