### Added

- Choose how many memories each agent can keep, from 64 to 512, in Settings > General.
- Essential memories: only the memories marked essential go into an agent's instructions, up to
  8 KB. The agent finds its other memories with a local search. In the memories window, mark a
  memory as essential or searchable, or let the app select. A memory that you add is essential when
  it fits in the 8 KB; a memory that an agent saves starts as searchable.
- The iPhone app and members of a joined server can read memory pages and change the selection
  through the new optional Team API capability `agent-memories-v1`.

### Changed

- Agents and Slack auto-replies send fewer tokens: the full memory list is no longer in each prompt.
  Secrets in memories are redacted before they go to a provider.
- **The database upgrades to version 36. After the upgrade, GoAhead 0.37.0 and earlier cannot open
  it, so do not go back to an older version.** Your memories, routines, triggers and runs stay
  unchanged.
- **Check each agent's memories after the upgrade.** Recent manual memories, then recent automatic
  memories, become essential until the 8 KB limit. The others become searchable: they are not lost,
  and the agent finds them with a search, but they are no longer in every prompt. Mark a memory as
  essential in the memories window if the agent must always see it.

### Fixed

- An agent with a full memory now gets an error when it tries to save one more memory, and it can
  merge or forget a memory in the same turn. Before, the new memory was lost when the turn ended.
