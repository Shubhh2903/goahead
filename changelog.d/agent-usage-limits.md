### Added

- A turn now stops after 40 tool calls or about 3 million processed tokens, whichever comes first.
  This applies to every turn: yours, an agent's, a routine's, a channel's and Slack's. A card appears
  in the chat. Allow sends a "Continue" message to the same chat, channel task or Slack thread, and
  the work starts again there. Allow sends nothing when that place already has a running turn or a
  waiting message, or cannot take a message now. Deny keeps the turn stopped. A turn that you stop
  gets no card. You answer the card on this computer only.
- Grok and the other ACP providers do not send a token count. For them, only the tool-call limit
  applies. After an app restart, GoAhead does not count the first Codex model call of a turn. An
  open card does not stay after a restart.
- Agent settings has a new "Turn limit" setting: 40 tool calls (default), 100, 200 or Off. The token
  limit grows with it: 3 million, 7.5 million or 15 million. The setting stays on this computer.
- GoAhead now asks before an agent runs a command that installs large tools: creating a simulator or
  adding a simulator runtime, `xcodebuild -downloadPlatform` or `-downloadAllPlatforms`, `sdkmanager`
  installs, `avdmanager create`, `pod install` and `pod repo update`. A card shows the command. You
  answer it on this computer only. Allow lasts 60 minutes for that agent and that kind of command.
- On Claude, the card appears before the command runs. On Codex, Grok and the other ACP providers,
  GoAhead stops the turn when the command starts, so the command can start before the stop. Check
  the Trash and disk space if you do not want a large download.
- Settings > Storage now lists folders in the Agents folder that no agent in this GoAhead profile
  uses, when a folder is 1 GB or more. Other GoAhead profiles and OpenBot installs on this Mac use the
  same Agents folder, so GoAhead lists a folder only when no file in it changed in the last 7 days.
  It warns when the listed folders use 5 GB or more in total. Move to Trash, with a confirmation,
  puts a folder in the Trash, and you can put it back from there. GoAhead does not list, and does not
  move, an agent's workspace or project folder, a folder that holds one, a folder that has the name
  of an agent of this profile, an unfinished copy, or a folder that is too large to read to the end.
  This works on this computer only.
- The "Agent workspaces" total in Settings > Storage now also counts the folders and files in the
  Agents folder that no agent uses. A joined server's Storage tab shows the same larger total.
- Agents have a tool to reserve the shared mobile QA device. Only one agent holds it at a time, and
  the reservation ends after 30 minutes unless the agent reserves it again.

### Changed

- **After this update, every agent stops a turn after 40 tool calls and asks you to continue,
  compacts its conversation at 120,000 tokens, and runs turns from a teammate or a routine on the
  smaller model. You do not have to do anything. To keep the old behavior for an agent with long
  unattended work, open its settings and set "Turn limit" to Off, "Compact early" to 200,000, and
  turn off "Use the smaller model for teammate and routine turns".**
- If you go back to v0.40, these three settings return to their v0.40 defaults. No data is lost.
- Claude and Codex agents now compact their conversation at 120,000 tokens by default. The "Compact
  early" setting offers 80,000, 120,000 and 200,000. There is no "Off" option now. Codex also
  compacts in the middle of a turn.
- Claude releases an idle agent process after 2 minutes. Before, it waited 10 minutes. The agent
  keeps its chat, workspace and session.
- A new agent that you create with a role now receives the role as its instructions and "Greet me
  briefly." as its first message. This applies on desktop and on the web.
- Agents get shorter instructions about their scope and shorter answers by default.
- A turn that a teammate or a routine starts now runs on the provider's smaller model, such as
  Claude Sonnet, when the agent uses a larger model. Its effort is the agent's effort, but not more
  than medium. A turn with a message from you, or from a person in Slack, keeps the agent's model.
  The answer shows "Answered by" with the model name. Agent settings has a new switch for this, "Use
  the smaller model for teammate and routine turns". It is on by default and stays on this computer.
- A teammate's answer to a request that an agent sent uses the model rule of the turn that sent the
  request. When you started that turn, the answer turn keeps the agent's model. When a teammate or a
  routine started it, the answer turn can use the smaller model.
- When you allow a turn to continue after a turn limit or an install card, the continued turn uses
  the same model as the stopped turn: the smaller model for a teammate or routine turn, and the
  agent's model for your turn. This applies in the chat, in a channel and in Slack. After an app
  restart, a "Continue" message that still waits counts as your message.
- A scheduled routine run that is skipped again for the same reason, such as a run condition that
  finds no change, now adds no new "Cancelled routine" row to the chat. The routine history keeps
  each run, and the Usage tab still counts each skipped run. A new row appears when the reason
  changes or after a run that was not skipped. One exception: a run that the plan limit skips adds
  no row when the run before it was cancelled with no reason, for example a run that you cancelled.
- A routine can now run one time. On desktop, choose "Once" and a date and time in the schedule
  picker, or ask an agent for a one-time routine. The routine runs at that time. If GoAhead was
  closed then, a routine set to run missed times once runs one time when GoAhead opens; other
  routines record the time as missed. Then the routine turns off and shows "Done". A run that waits
  for the plan reset keeps the routine on until the run ends.
- When a one-time routine cannot run at its time, because an earlier run of it is still in progress,
  or because the plan limit is reached and the routine skips runs then, GoAhead records the time as
  a cancelled run with the reason. The chat shows the row, and the routine turns off.
- The phone app cannot create a one-time routine. This includes the v0.40 phone app.
- GoAhead keeps a one-time routine as an interval of 100,000 days that starts at its time. The v0.40
  desktop app shows it as "Every 100000 days". The v0.40 phone app shows it as the custom schedule
  `0 0 */31 * *` with its note that the schedule is kept. Both keep the schedule when you do not
  change it. A v0.40 host runs the routine one time, but does not turn it off: it shows a next time
  about 270 years later. A v0.40 host does not refuse a time that has passed. A routine with such a
  time never runs.
- An agent that you install from the marketplace or from a template keeps the time of its one-time
  routines. When that time has passed, GoAhead installs the routine off, with its time kept, and the
  install continues. An imported agent or channel archive does the same.
