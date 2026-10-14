### Changed

- Slack auto-reply uses fewer tokens. Each Slack conversation gets a short-lived reply context, not
  the Slack Orchestrator's main chat. A reply sends only the new messages. On Claude, a reply uses
  Claude Sonnet 5.5 at low effort with only the Slack send tool. The orchestrator's own chats
  keep its model.
- Auto-reply waits 20 seconds after the last message (at most 90 seconds) and pauses after 6 fast
  replies in a row. Before, it waited 10 seconds (at most 60) and paused after 10 replies.
- The "Auto-reply paused" card shows in the orchestrator's chat without a model turn.
