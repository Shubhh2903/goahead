import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from "./slack-app";

// The Worker asks Slack for the contract's scopes, and Slack grants only what the app's manifest
// lists. A scope missing from a manifest makes every install of that app lack it.
describe("Slack app manifests", () => {
  for (const app of ["development", "production"]) {
    it(`${app} lists the contract's bot and user scopes`, () => {
      const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, `../../../apps/slack-app/${app}/manifest.json`), "utf8"),
      );
      expect([...manifest.oauth_config.scopes.bot].sort()).toEqual([...SLACK_BOT_SCOPES].sort());
      expect([...manifest.oauth_config.scopes.user].sort()).toEqual([...SLACK_USER_SCOPES].sort());
    });
  }
});
