### Changed

- **Before you update, read this:**
  - **The update changes your database to a new format (schema 37 to 74). You cannot undo this
    change. After the update, GoAhead v0.41 and earlier cannot open your data. GoAhead does not make
    a backup for you. To keep a way back, copy your GoAhead data folder before you update.**
  - **The first start after the update can need free disk space of about two times the size of your
    database. Make sure that this disk space is free before you update.**
  - **macOS can ask for access to Calendar and Reminders when a command that an agent runs uses
    them. Allow or deny each prompt.**
  - **Some layout preferences go back to their defaults: the width of the browser panels and the
    sidebar view. Set them again if you changed them.**
  - **GoAhead makes new remote-desktop credentials each time it starts. It does not keep them on
    disk now.**
- GoAhead now includes the features of OpenBot v0.77. Some of them:
  - Workflows: draw a workflow on the Workflows page, with image and video steps, triggers from
    GitHub, Slack, Discord and Telegram, and Pause.
  - An agent can have more than one conversation, open side threads, and run tasks at the same time
    as its chat.
  - A Library page shows the pictures and files of the chats of a server.
  - The Vault keeps logins, payment cards, contact information and API keys for your agents.
  - Voice: read replies aloud, talk to an agent in the Voice pane, and push to talk.
  - New providers, such as Mistral, Kimi, DeepSeek, OpenRouter, Devin and GitHub Copilot.
  - The agent dock, a menu bar icon on macOS, Settings > Keyboard, and a sidebar filter.
  - Agents save memories in the background and can learn new skills.
- GoAhead keeps its own behavior from v0.40 and v0.41:
  - A turn stops after 40 tool calls or about 3 million tokens and asks you to continue. Agent
    settings > "Turn limit" changes this.
  - GoAhead asks before an agent runs a command that installs large tools, such as a simulator
    runtime or `pod install`.
  - Claude and Codex agents compact their conversation at 120,000 tokens by default. The agent's
    "Compact early" setting comes first, then the server setting, then 120,000.
  - A turn that a teammate or a routine starts runs on the smaller model of the provider.
    Agent settings has a switch for this.
  - A routine can run one time. GoAhead v0.40 and v0.41 servers also accept a one-time routine from
    this version.
  - Settings > Storage lists folders in the Agents folder that no agent uses, and can move them to
    the Trash.
  - A window backdrop image or video that you uploaded in v0.40 still shows. New uploads use the new
    backdrop store.
  - The chat order in the sidebar stays "Manual" on desktop and on the phone until you change it.
