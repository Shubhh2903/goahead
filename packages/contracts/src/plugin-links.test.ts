import { describe, expect, it } from "vitest";
import { createInviteUrl } from "./invite-links";
import { createOpenBotPluginUrl, createPluginShareUrl, isPluginUrl, parsePluginUrl } from "./plugin-links";

const invitePayload = {
  apiUrl: "https://studio-mac-k7m4q2pz-host.openbot.run/",
  serverId: "00000000-0000-4000-8000-000000000000",
  fingerprint: "a".repeat(43),
  token: "b".repeat(43),
};

describe("OpenBot plugin links", () => {
  it("builds both forms from a slug", () => {
    expect(createPluginShareUrl("aave")).toBe("https://goahead.multicodegenius.com/plugins/aave");
    expect(createOpenBotPluginUrl("aave")).toBe("goahead://plugins/aave");
  });

  it("reads back the slug it wrote, in either form", () => {
    expect(parsePluginUrl(createPluginShareUrl("linear-triage"))).toBe("linear-triage");
    expect(parsePluginUrl(createOpenBotPluginUrl("linear-triage"))).toBe("linear-triage");
  });

  it("refuses to build a link for a slug it would not read back", () => {
    expect(() => createPluginShareUrl("Aave")).toThrow();
    expect(() => createOpenBotPluginUrl("catalog.json")).toThrow();
  });

  it.each([
    ["a foreign origin", "https://evil.example/plugins/aave"],
    ["a host that only ends in the real one", "https://goahead.multicodegenius.com.example.com/plugins/aave"],
    ["the lookalike host the app once used", "https://openbot.app/plugins/aave"],
    ["http", "http://openbot.run/plugins/aave"],
    ["another path", "https://goahead.multicodegenius.com/other/aave"],
    ["no slug", "https://goahead.multicodegenius.com/plugins/"],
    ["a second path segment", "https://goahead.multicodegenius.com/plugins/aave/install"],
    ["a trailing slash", "https://goahead.multicodegenius.com/plugins/aave/"],
    ["a query", "https://goahead.multicodegenius.com/plugins/aave?install=1"],
    ["a hash", "https://goahead.multicodegenius.com/plugins/aave#install"],
    ["a port", "https://goahead.multicodegenius.com:444/plugins/aave"],
    ["a user name", "https://user@openbot.run/plugins/aave"],
    ["an upper-case slug", "https://goahead.multicodegenius.com/plugins/Aave"],
    ["a slug with a dot", "https://goahead.multicodegenius.com/plugins/catalog.json"],
    ["an over-long slug", `https://goahead.multicodegenius.com/plugins/${"a".repeat(64)}`],
    ["another custom-scheme host", "openbot://plugin/aave"],
    ["a custom-scheme link with a query", "goahead://plugins/aave?install=1"],
    ["a custom-scheme link with no slug", "goahead://plugins"],
    ["nonsense", "not a url"],
  ])("refuses %s", (_reason, value) => {
    expect(() => parsePluginUrl(value)).toThrow();
    expect(isPluginUrl(value)).toBe(false);
  });

  /* The router asks the invite parser first, but the plugin parser must not claim an invite even on
     its own. `join` is the invite's host and `/join` is its path. */
  it("refuses an invitation link", () => {
    expect(isPluginUrl(createInviteUrl(invitePayload))).toBe(false);
    expect(isPluginUrl("goahead://join")).toBe(false);
  });
});
