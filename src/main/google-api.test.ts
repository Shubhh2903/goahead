import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GoogleApiClient, GoogleApiError } from "./google-api";
import { type FakeGoogleServer, startFakeGoogleServer } from "./google-test-server";

describe("GoogleApiClient", () => {
  it("never sends a changing request twice after a 5xx or a lost answer", async () => {
    const fake: FakeGoogleServer = await startFakeGoogleServer();
    try {
      const token = fake.issueAccessToken();
      const url = `${fake.origin}/gmail/v1/users/me/drafts/send`;
      let lose = false;
      let fetchCalls = 0;
      const client = new GoogleApiClient({
        tokens: { accessToken: async () => token, renewAccessToken: async () => token },
        onReauthRequired: () => undefined,
        fetch: async (target, init) => {
          fetchCalls += 1;
          if (lose) throw new TypeError("network lost");
          return fetch(target, init);
        },
        sleep: async () => undefined,
      });
      const schema = z.object({ id: z.string() });

      fake.failNext("/gmail/v1/users/me/drafts/send", 503, 503);
      await expect(client.json(url, schema, { method: "POST", body: { id: "draft-1" } })).rejects.toBeInstanceOf(
        GoogleApiError,
      );
      const sends = () => fake.requests.filter((request) => request.path.endsWith("/drafts/send")).length;
      expect(sends()).toBe(1);

      lose = true;
      fetchCalls = 0;
      await expect(client.json(url, schema, { method: "POST", body: { id: "draft-1" } })).rejects.toBeInstanceOf(
        GoogleApiError,
      );
      expect(fetchCalls).toBe(1);
      expect(fake.sentDraftIds).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });
});
