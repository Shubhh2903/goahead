### Added

- Auto-reply for one Slack conversation. Turn it on in the conversation header of the Slack inbox.
  Then the Slack Orchestrator replies to new messages from other people in that conversation, and
  agent replies there are sent as you without approval. GoAhead marks each one "Auto-sent". You can still edit or delete them. Auto-reply is off for every conversation until
  you turn it on, and other conversations still need your approval.

### Changed

- Auto-replies and inbox requests show as a short card in the orchestrator's conversation.
- Agents can send any number of Slack messages; auto-reply stops in a conversation that looks like a
  reply loop. After 10 fast auto-replies in a row, auto-reply pauses there and the Slack Orchestrator
  asks you to check it. Your next message to the orchestrator, or your own message in that
  conversation, starts auto-reply again.

### Fixed

- A Slack Orchestrator that an earlier version added now gets the current rules when GoAhead starts.
  If you changed its rules, GoAhead keeps your text. Text that you added before or after the rules
  also stays.
- Slack drafts that wait for your approval stay after you restart GoAhead. You can still approve or
  deny them, and an approved draft is sent only once.
- When Slack stops accepting GoAhead's access (for example, the app was removed from the workspace),
  GoAhead turns auto-reply off in every conversation of that workspace. After you connect again, you
  turn it on again where you want it.
