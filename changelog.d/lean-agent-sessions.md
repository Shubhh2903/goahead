### Changed

- Claude agents no longer load your personal Claude Code plugins, skills, subagents, hooks and personal CLAUDE.md. Each agent starts with less context and runs no personal hook on each turn. The project settings and skills of the agent's workspace still load, and the environment and sign-in helper commands of your Claude Code settings still apply.

### Fixed

- The usage view no longer counts a resumed Claude session twice. Before, the first turn after an agent was idle for 10 minutes, or after GoAhead restarted, added the whole session's tokens and cost again.
