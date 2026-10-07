// SPIKE (CP6 multi-user), development only. Lists every installed person that one Slack event is
// visible to, with `apps.event.authorizations.list`. Slack names only one of them in the event itself.
//
// Usage: SLACK_APP_TOKEN=xapp-… bun scripts/dev-slack-authorizations.ts <event_context>
// The app-level token needs the `authorizations:read` scope (Slack app settings > Basic Information >
// App-Level Tokens). The event context comes from the `slack-spike` log of the host.
// Prints user and team IDs only. Remove after the spike.

import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("dev-slack-spike");

async function main() {
  const token = process.env.SLACK_APP_TOKEN?.trim();
  const eventContext = process.argv[2]?.trim();
  if (!token?.startsWith("xapp-") || !eventContext) {
    logger.error("Usage: SLACK_APP_TOKEN=xapp-… bun scripts/dev-slack-authorizations.ts <event_context>");
    return 1;
  }
  const response = await fetch("https://slack.com/api/apps.event.authorizations.list", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ event_context: eventContext }),
  });
  const payload = await response.json().catch(() => null);
  if (!isDynamicRecord(payload) || payload.ok !== true) {
    logger.error("Slack refused the request.", {
      error: isDynamicRecord(payload) ? payload.error : response.status,
    });
    return 1;
  }
  const authorizations = Array.isArray(payload.authorizations) ? payload.authorizations.filter(isDynamicRecord) : [];
  logger.info("Authorizations for the event.", {
    authorizations: authorizations.map((item) => ({ user: item.user_id, team: item.team_id, isBot: item.is_bot })),
  });
  return 0;
}

process.exitCode = await main();
