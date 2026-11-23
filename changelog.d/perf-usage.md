### Changed

- New Claude agents start on Sonnet 5.5 at medium effort instead of Opus 5.5 at high effort, which
  uses much less of a Claude plan and answers faster. Existing agents keep their model and effort.
- New Codex agents start at low effort when the model supports it, as the built-in Codex default
  does. An agent that creates a teammate still passes on its own model and effort.
- A click, typing or another browser action returns at most 6,000 characters of page text to the
  agent instead of 20,000. The list of page elements stays complete, and `snapshot` and `navigate`
  still return the full text.
- Agents get GoAhead's tool definitions only when they need them. Claude and Codex now see a short
  core set and load the others, such as browser, routine and site tools, through tool search. Each
  request carries up to about 80,000 fewer characters of tool definitions. Existing Codex agents start
  a new provider session once, on their next message.

### Fixed

- Saving a memory no longer restarts a Claude agent's session, which made its next turn read the
  whole conversation again without the prompt cache.
