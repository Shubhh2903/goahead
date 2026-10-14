### Changed

- GoAhead now reads provider history in pages and saves each page when it arrives. Long chats no longer need a
  full copy of the provider transcript in memory, and GoAhead keeps only the recent part of each chat in memory.
- GoAhead requires Codex CLI 0.156.0 or newer to read Codex history in pages. The included Codex runtime is now
  0.160.1.
- The provider message size limit is now 256 MB, up from 128 MB, so larger single records can load.

### Fixed

- GoAhead keeps saved messages and their attachments when a history import fails or continues after a restart.
  Before, a failed read could leave a chat without the turns that the provider did not send again.
- After a provider stops because a message was too large, you can change the model and the provider again.
  Before, a turn that no longer ran could block the change.
- A message that the provider accepted is not sent a second time when GoAhead cannot save its start.
- An OpenCode, Grok, Cursor, Cline, Gemini or custom ACP agent that keeps a session only in its process now keeps
  that process running while the session is open, so its context is not lost.
