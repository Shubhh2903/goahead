### Changed

- A message that you send shows in the chat immediately, with the status "Sending". The composer stays available for the next message. Messages that you send quickly go to the agent in the order that you sent them.
- In the web client, a failed send does not block the composer. The message stays in the chat with the reason for the failure.

### Added

- A message that GoAhead could not send stays in the chat with Retry, Edit and Dismiss. Retry does not send the message two times, also when the first attempt got to the server and only the answer was lost. A server with an older version cannot find a repeated message, so for that server the chat shows only Edit and Dismiss.
- A message that GoAhead did not send before a restart is back in the composer of its chat after the restart. GoAhead does not send it again on its own.
