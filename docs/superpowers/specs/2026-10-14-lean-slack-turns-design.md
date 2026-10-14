# Lean Slack auto-reply turns

Status: approved goal, 2026-10-14. Scope: `src/backend/messaging`, `src/backend/agent`, `claude-client.ts`.

## Problem

Each auto-reply turn goes into the orchestrator's main thread. That thread grows with no limit
(45K to 118K tokens for each call in one week). Each prompt also sends the 20 newest messages and the
project map again. The orchestrator uses Opus 5.5 with high effort and the full tool and instruction
set. The `auto-reply-paused` notice starts a full turn to show one line.

## Decisions

1. **One reply context for each Slack conversation.** It is a row in `projection_messaging_threads`
   with the reserved thread key `goahead:auto-reply`. The row gives a persistent execution thread
   with no migration: boot recovery registers it, agent deletion removes it, and the event filter
   keeps it out of the public chat. The link reads (`linkForThread`, `links`, `recentLinks`) do not
   return it. Thus every send and inbox gate sees the same "no link" thread as before, and
   `#autoReplyFromApp` stays the only send path. That path now also requires that the send comes
   from the thread of the running auto-reply. Until that thread is known, the turn is `pending`:
   no send and no turn event is its own. A delivery goes to the context when its
   `slackAsk.kind` is `auto-reply`. The main thread does not get the turn. The chat card stays in the
   main chat as a record.
2. **Short life.** A context is replaced when it has 10 turns, when it was idle for 1 hour (the prompt
   cache is cold then), or when the orchestrator changed. GoAhead does not replace a context while
   the agent has a turn that runs.
3. **Only new messages.** The link's `history_cursor` keeps the newest Slack `ts` that the context
   read. A new context gets the 20 newest messages and the project map. A later turn gets only
   messages after the cursor, without GoAhead's own auto-sent messages. The cursor is written only
   when the turn completes or its reply is auto-sent, so a failed turn reads the messages again. An
   auto-reply reads the whole conversation (threads marked), so one cursor covers every thread.
4. **Lean model and tools (Claude only).** A reply-context session uses `claude-sonnet-5-5` with
   `low` effort, at session start and on each turn. It has a short system prompt (profile, memories
   as read-only text, Slack rules), no built-in tools, no browser server, no user MCP servers, and
   only `slack_send_message`: other people's text drives it, so it cannot change memories. The
   orchestrator's own chats keep its model.
   Codex and the other providers keep their model, tools and instructions. They get decisions 1-3.
5. **Batching.** Wait 20 s after the last message (was 10 s), cap 90 s (was 60 s). Chat bursts of
   2-4 lines come in 10-20 s, so more of them become one turn. A reply is still at most 1.5 minutes
   late. The loop guard pauses after 6 fast replies (was 10).
6. **Paused notice with no turn.** The notice is a mailbox message with a `completed` delivery and
   the existing `auto-reply-paused` card. No model turn starts.

## Not changed

- `@chief` inbox asks stay in the main thread on the orchestrator's model. The person reads the
  answer in that chat, and a side context would hide it.
- All gates: `runningOrigin(...).fromPerson`, `#inboxConnection`, `#requestSend`, the loop guard,
  quiet hours and pause. An auto-reply turn still cannot read the inbox or use Gmail.
- The lean tool set has no `send_message`. A teammate's answer goes to the main thread, not to the
  context, so an auto-reply does not hand off work.

## Expected effect

Before: one auto-reply = 2 Opus calls at 45K-118K tokens each. After: 2 Sonnet calls at about 5K
tokens (first turn) to 20K tokens (tenth turn).
