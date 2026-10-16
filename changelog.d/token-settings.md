### Added

- Agent settings have three ways to use fewer tokens, on this computer only:
  - **Compact early** (Claude agents): the agent summarizes its conversation at 80K or 120K tokens,
    so each step reads less context.
  - **MCP** switches: turn off an MCP server for an agent that does not need its tools.
  - **Weekly tokens**: a weekly token budget. GoAhead shows a notification at 80% and at 100% of the
    budget. Work continues.
