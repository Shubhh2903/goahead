### Added

- Agent settings have a new "Choose model automatically" switch for Claude and ChatGPT agents. It is
  off for every agent until you turn it on, and it stays on this computer: a remote host does not get
  it.
- When it is on, a short chat message from you, with no attachments and no work words such as "fix"
  or "plan", can run on the provider's cheaper model (Claude Sonnet 5.5 or GPT-6 Luna) at low effort.
  Longer messages, attachments, routines, teammate messages and Slack or channel work keep the
  agent's own model.
- The switch happens only from a larger model: Opus or Fable on Claude, and Sol, Terra or Astra on
  ChatGPT.
- It happens only when the conversation has been quiet for 5 minutes, or when the cheaper model
  answered just before.
- The first turn on the other model reads the conversation without the provider's cache, so that
  turn can cost more than usual.
- The agent keeps its chat, workspace and session. The answer shows "Answered by" and the model name
  when the cheaper model answered.
