# Changelog

All notable changes to the OpenBot iPhone app will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md). The changes of the desktop app and the web client are in
the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [1.2.0] - 2026-10-17

### Added

- Brazilian Portuguese for the iPhone app. Select Português (Brasil) in Settings, or use your phone language.
- More of the iPhone app is in Turkish, including agents, chats, channels, servers and usage.
- Turkish (`tr`) language support in mobile app settings and interfaces.
- Routines for a server. Touch and hold a server in the server list, then select Routines. The week view shows the runs of each day with the agents that do them. Swipe the days to change the week. Select Day in the header to see one day; today also shows the next runs. Select a run to open its routine.
- Usage for a server. Touch and hold a server in the server list, then select Usage. The report shows the processed tokens and the estimated cost of all agents on the server, with the share of each agent. Select an agent in the list, or in the Agent row at the top, to see the usage of one agent.
- Buy a cloud server from the iPhone app. Tap + in the server list, choose a plan, and pay on a secure Stripe page. The app shows the setup until the server is ready, and the server shows on your computer too.
- Buy a cloud server from the Android app, version 1.1.0. Tap + in the server list and choose a plan.
- HTML pages and Mermaid diagrams in a reply. A code block marked `html` or `mermaid` shows as a
  card with a header and a small picture of the page or the diagram. Tap the card to open it on its
  own screen. Go back with the back button or a swipe from the left edge. Use the menu in the
  top-right corner to switch between Preview and Code, to wrap long lines of code, or to copy the
  code. Move a diagram with one finger, pinch to zoom, and double-tap to zoom in or to see the
  whole diagram. A page runs no scripts and loads nothing from the network.
- Settings → Support. It shows how to get help: report a problem on GitHub or message us on X. It also shows a support log of recent app events, connection steps, requests and errors. Select Save log file to save the log or attach it to a message. The log stays on your phone and OpenBot never sends it. It does not record messages or files, and it masks passwords and tokens. Select Clear log to remove it.
- In an agent chat on a team, each message from another person stands on the right, with your messages, and shows their name. Their bubble has their own color, so it does not look like yours. Messages sent before this update show as yours.
- Cursor and Cline agents on a server now show in the app. Before, the server kept them hidden.
- Visual replies. A chart, a table, a diagram or a mockup that a GoAhead agent shows as an HTML page
  on the computer appears in the phone chat as its HTML file, with the page title. The phone does
  not run the page. The page does not count as an unread message.
- Agent info groups the agent settings as the desktop app does: **Brain**, **Knows**, **Does**, and
  **Rules**. **Rules** has **Permissions**, **Notifications**, and **Advanced**.
- **Advanced** shows the workspace folder of the agent and can start a **New chat**. A new chat shows
  a "New chat started" divider in the chat.
- Owners and admins can turn **Computer Use** and **Local scripts** on or off for an agent, and
  select what a message does while the agent works (**Queue** or **Steer**). The computer that runs
  the agent must have the newest GoAhead desktop version.
- Owners and admins can see and delete the **Tables** that the agents share, and **Publish** an
  agent as a link template. The link preview of a template that you publish from the phone shows the
  general GoAhead image, not an agent card.
- Memories: choose which memories go into every prompt (**Always included**) and which the agent
  finds with search (**Search when needed**), or let the agent decide. The computer that runs the
  agent must have the newest GoAhead desktop version.

### Changed

- The routine schedule is easier to set. Select how often it repeats (hourly, daily, weekly, monthly or yearly), then the days and the time, as on desktop. A cron expression is now the last choice, for advanced schedules only.
- The agent Usage page has a clearer period control. Select 7 days, 30 days, 90 days, 1 year or Custom. For Custom, set the start and end dates with the date pickers. The report changes at once. The daily chart is now the chart of the desktop app: one area for each provider, in its color, with the values on a grid. Touch or drag across the chart to see a day, with the value of each provider under it. When you change the period or the agent, the report stays on screen and its numbers and chart move to the new values.
- The OpenBot logo no longer turns when you turn your phone, and the app no longer uses motion access.
- Settings → About shows the build number after the version, such as "1.1.0 (17)".
- A routine run in a chat shows as one short line with the routine name and its state. The chat no
  longer shows the routine instruction as your message.
- The app is now named GoAhead. The home screen, permission prompts, the About screen and saved support logs show the new name.
- The iPhone app is now the GoAhead app (`com.multicodegenius.goahead.mobile`). It pairs with the GoAhead desktop and opens `goahead://` links and links of `goahead.multicodegenius.com`. **It installs as a new app: scan the QR code of the desktop once.** It still reads the QR code of a released OpenBot desktop.
- About shows the GoAhead website. Support opens issues in the GoAhead repository. The rows for the OpenBot privacy policy and the OpenBot X account are removed.
- The app sends no product analytics.
- The app is in English only for now. The language setting offers System default and English. If
  you chose French, Japanese, Portuguese or Turkish before, the app shows English.
- A scheduled routine run that answers only `[[no-update]]` on the computer shows no notification
  and no Live Activity update on the iPhone.

### Fixed

- The iPhone app now shows the year on a date that is not from the current year. Before, a message from last year and one from this month could show the same day and month, and the list could not be read by recency.
- When you ask an agent to create a routine from the iPhone app, the routine now runs in the
  phone's timezone. Before, it ran in the server's timezone. The server must be updated too.
- The app no longer stops at start with "Cannot find native module 'ExpoWidgets'" in a build without Live Activities. It opens without them.
- Opening a chat with unread messages marks them read. Before, the unread dot stayed until you
  scrolled to the bottom when the chat opened in the middle of its history.
- A long press on a server in the server list keeps the list open while the menu shows.
- Keep the connection to your desktop when the phone changes between Wi-Fi and mobile data, or
  loses mobile data for a short time. Before, the app made a new connection after 5 seconds,
  waited 10 seconds between attempts, and waited 2 minutes after 5 failed attempts.
- Reconnect as soon as the phone gets a network again, not at the next planned attempt.
- Keep a new connection over a slow mobile network. Before, the first check of the desktop stopped
  after 3 seconds and started the connection again.

## [1.1.0] - 2026-09-29

### Added

- Choose the app language in Settings > General: System default, English, French or Japanese. Text
  that has no French or Japanese translation yet shows in English.
- Search agents and the messages in their chats on the connected computer. Search and add are two
  separate buttons on the home screen.
- An agent plan shows as a task list, as on desktop: a card that opens and closes, with the state of
  each step and a spinner on the step that runs.
- A file name in inline code, such as `package.json`, shows a type badge and the color of its file
  type, as on desktop.
- A failed message shows the reason below it. When the computer gives no clear reason, the app
  tells you to send the message again.
- Owners and admins can set the access of an agent (Workspace only or Full access) and Auto approve
  on the Runtime page of the agent. Full access asks for confirmation first.
- Owners and admins can change the server name and logo in Server options. The server list shows the
  logo.
- Haptic feedback when you open and close screens, pick options, save, and when an action succeeds
  or fails. Turn it off with the Haptics setting.
- Open a shared agent link (`https://openbot.run/agents/...` or `openbot://agents/...`) in the app.
  You see the agent before you add it, and you choose the server where you are owner or admin.
  Before, the link opened Safari or showed "Link unavailable".
- Manage the skills of an agent from Agent info > Skills. An owner or admin can turn a skill on or
  off and uninstall it. A folder skill stays read-only, and a member sees only the list.
- Create a skill from Agent info > Skills. An owner or admin taps +, and the app puts the request
  in the agent chat. The agent then asks what the skill is for.
- The skill list updates by itself when a skill changes on the computer or on another device. The
  computer must run a version that sends these updates.
- Chat messages show LaTeX math as formulas. Write inline math as `$...$` or `\(...\)`, and display
  math as `$$...$$`, `\[...\]` or a `math` code block. A formula that does not parse shows its
  source.
- Turn off the agent color on your messages in Settings > General > Appearance. Your messages then
  use the neutral color. The setting is on by default.
- The message box continues a Markdown list. Press Return after a `- `, `* ` or `1. ` item to start the next item. Press Return on an empty item to end the list.
- When you open a hosted server that stopped after it was not in use, the app starts it again and connects when it is ready.
- The Lock Screen and the Dynamic Island show what your agents do, as the desktop Dynamic Island
  does: work, new replies, questions, approvals, browser steps, and failed tasks. You can answer an
  approval or a short question from the Lock Screen. OpenBot asks again before it approves a command.
  When several agents have new replies, the activity lists them. Settings > General > Live Activities
  turns this off. When iOS stops OpenBot in the background, the host keeps the activity current
  through Apple. The update is encrypted for your phone, so Apple and OpenBot cannot read it.

### Changed

- The question form of an agent has no text field of its own. Tap "Reply in the chat", and your next
  message from the composer is the answer. A private answer still uses its own masked field.
- An answer from a teammate agent shows under "Waiting for replies" in the queue sheet, and not as a
  queued message that you can edit, steer or move. The computer must run a version that sends this
  information.
- Server members shows how many members the server has of its limit, for example "1 of 3 members".
  When the server is full, you cannot create an invitation until you remove a member.

### Fixed

- The highlight of the selected server fills the full row in the server list. Before, it stopped at
  the end of the server name.
- Search shows only results from your computer. Before, it showed sample English results.
- Chat previews and search results show message text without Markdown marks such as `**`.
- The keyboard closes when you leave a chat with the back button or a swipe. Before, the keyboard
  stayed open over the agent list, and you could not close it.
- Long inline code in a chat message breaks across lines. Before, the code wrapped inside its box
  and covered the line above.

## [1.0.0] - 2026-09-28

### Added

- First mobile release.
