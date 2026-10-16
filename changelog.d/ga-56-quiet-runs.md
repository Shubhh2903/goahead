### Added

- A scheduled run of an agent routine can stay silent when it has nothing to report. Ask the agent in
  the routine task to answer `[[no-update]]` in that case. When every answer of the run is only
  `[[no-update]]`, the run posts no message, adds no unread message, does not change the chat
  preview and shows no notification. The run marker stays in the chat, and the run stays in the
  routine **History**. Test runs and script runs always show their result. An older client shows
  the run as finished, as before.
