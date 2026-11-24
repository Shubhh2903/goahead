### Changed

- Hand-offs between agents use fewer turns. When an agent sends requests to several teammates in one
  turn, their answers come back together in one turn, not one turn for each answer. An answer waits
  at most 5 minutes for the slower teammates of the same turn, and it does not wait for a teammate
  whose plan limit is used up. A message from you still takes the answers that are in with it.

### Fixed

- A teammate's answer longer than 100,000 characters no longer gets lost. The requesting agent gets
  a shortened copy, and the full answer stays in the teammate's conversation.
