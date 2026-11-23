/**
 * The provider notification that carries text a turn holds back before it can tell narration from
 * its answer. `ClaudeAgentClient` sends it, and `TurnLifecycle` turns it into the local
 * `turn-text-preview` event, which never leaves this computer.
 */
export const TEXT_PREVIEW_METHOD = "openbot/textPreview";
