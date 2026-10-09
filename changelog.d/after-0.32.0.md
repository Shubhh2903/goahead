### Added

- Reading or answering a conversation in the GoAhead Slack inbox now also marks it read in Slack.
  **Connect Slack again once** to give GoAhead the access this needs.
- Start an inbox reply with `@chief` to ask the Slack Orchestrator instead of sending to Slack. It
  gets the conversation as context and gives the work to your agents.
- Give an agent your project folders in its settings (Project folders > Add folder). The agent works
  in them directly, and the Slack Orchestrator knows which agent owns which project, so "@chief fix
  the login in roadside" goes to the right agent. The folders stay on this computer.
- Hide a Slack conversation from the sidebar (right-click > Hide), or hide all of them with Clear
  history on the Slack Orchestrator. Nothing is deleted; a conversation comes back with a new message.
- See how agents work together. When the Slack Orchestrator gives a task to another agent, the Slack
  thread shows one status message that updates itself ("Chief → Builder: …", then the agent's
  steps, then "done"), and Chief's conversation in GoAhead shows a card with the task, the live
  steps and the reply.
- Agents check that the tools a task needs are installed before they start. When one is missing,
  they say so first and give the install command; they install it when you ask.
- Claude Sonnet 5.5 is now in the model list. A new Slack Orchestrator starts on it, with medium
  effort, so it answers faster than on Opus.
