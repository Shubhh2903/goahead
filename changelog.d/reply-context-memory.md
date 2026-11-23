### Fixed

- A Slack auto-reply of a Codex agent now has only the Slack send tool, as on Claude. Before, a
  Slack message from another person could make it run commands, browse, delegate, or change the
  agent's memories. Its session reads only and cannot write files.
