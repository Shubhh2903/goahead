### Added

- GoAhead adds Pi and Muse as providers. Pi runs in its native RPC mode, and Muse runs `muse serve`
  through the official Muse SDK. GoAhead can download and pin each CLI, and checks its files against
  the hashes in `native-runtime.lock.json`.
- Pi signs in with `/login` in a terminal on this computer. Muse signs in with `muse login` or with a
  Meta API key that GoAhead keeps encrypted.
- Settings has an ACP registry section. You can search the registry, and install, update, cancel, or
  remove an agent on this computer. Remove runtime keeps the agent's settings, credentials, and
  conversations.

### Changed

- Pi and Muse agents stay on this computer. Team members do not see them, and the Team API protocols
  do not change.
