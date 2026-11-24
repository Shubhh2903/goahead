### Fixed

- A message that you send to a busy Claude agent now reaches it while a tool or a subagent runs. Before,
  the agent read the message only after the tool was done. A message that you send while the agent
  waits for your answer to a question or an approval still waits for that answer.
- Stop now ends a Claude chat that stays "working" after Claude has stopped. The next message in the
  queue then runs. Stop also removes the live text preview at once.
- For a Claude agent on a joined server, that server must also run v0.40 to get these fixes.
