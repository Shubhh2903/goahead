### Added

- Settings > Providers has an "Update all" button. It shows when one or more providers have an update.
  It starts each update once, and it shows the result for each provider. A failure on one provider does
  not stop the others. On a joined server, it works for an owner or admin of that server.
- When GoAhead waits for the agents to become idle before it installs an update or restarts,
  Settings > Updates now has a "Restart now" button. A confirm tells you that agent turns and routine
  runs that did not finish stop now. "Keep waiting" keeps the wait.

### Changed

- GoAhead now updates the provider CLIs that it downloaded by itself to the version that this GoAhead
  release ships with, at start and then each hour. It does not install a newer upstream release by
  itself: that stays an "Update available" offer. It starts only when the agents of that provider are
  idle. It downloads the new CLI first; new messages to that provider wait only for the short switch to
  the new CLI, not for the download.
  A CLI that you installed yourself and a CLI with a custom path are not changed. If you cancel an
  automatic update, GoAhead does not start it again until GoAhead restarts.
