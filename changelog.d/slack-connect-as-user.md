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
- Agents can send one message to a group direct message with several people (up to 8). When anyone
  in that group answers, the answer comes back to the thread where you asked. Other group messages
  never reach an agent.
- Slack conversations now show in the sidebar, under the agent that answers them, with the newest
  first, the start of the newest message, and a count of unread messages. Select one to read it.
  The view is read-only: the agent answers in Slack, and approvals stay on the Slack buttons.
- All direct messages from one person to GoAhead are now one conversation, so the agent remembers
  what that person said before. GoAhead still answers under each message. Direct messages sent
  before this version stay as separate conversations.

- Ask GoAhead in your Slack direct message "what is new?" or "summarize #launch". When you connect
  Slack as you, GoAhead keeps a local Slack inbox on your computer: your direct messages, group
  messages, mentions, and the channels you pick in Settings > Connectors > Slack. Messages are kept
  for 30 days and deleted when you disconnect. Only you can ask an agent to read them, in your own
  direct message with GoAhead.

### Fixed

- After a restart, a Slack conversation could become the Slack Orchestrator's own chat when you had
  not opened that chat yet. Slack conversations now stay separate.
