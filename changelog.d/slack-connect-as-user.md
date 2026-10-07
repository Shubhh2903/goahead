### Added

- Connect Slack as you. When you connect a workspace, GoAhead now also asks Slack for your own
  access, next to the GoAhead app's, so your agents can later read what you can see and reply as
  you after you approve. Settings > Connectors > Slack shows "Connected as @you". Disconnect
  revokes both accesses. A workspace connected before this version keeps working; reconnect it to
  add your access.
- Agents can send a new Slack message to a person or a channel for you. When you ask @GoAhead
  yourself, the message goes out at once, as you, with only the words you asked for. When someone
  else asks, the message waits in the Slack thread with Approve and Deny buttons, and only you can
  approve it. Each send is kept in the audit log.
- When someone answers a message that GoAhead sent for you, the answer comes back to the Slack
  thread where you asked, and the agent tells you who replied and what they said. Only answers to
  messages GoAhead sent are picked up; your other Slack messages never reach an agent.
