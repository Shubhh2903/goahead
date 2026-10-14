### Added

- GoAhead has a Routines view in the sidebar. It shows a canvas for the open agent with its routines, the agents
  that each routine reaches, when each routine runs next and how its last runs went.
- A routine can hand its agent's answer on to other agents. Draw a connection from one agent to the next on the
  canvas, and give it an instruction. An agent with more than one input waits for all of them and gets them in
  one message. A connection applies to the runs that start after you make it.
- Agents can read and change routine flows with the `list_routine_flows`, `connect_routine_agents` and
  `disconnect_routine_agents` tools, and the canvas has a chat panel that sends your request to the open agent.

### Changed

- GoAhead adds database migration 34 for the routine flow tables. The migration only adds empty tables, so all
  routines, runs, chats and Slack data stay as they are.
- Routine flows are only for agents on this computer. A remote server answers that it does not support them.
