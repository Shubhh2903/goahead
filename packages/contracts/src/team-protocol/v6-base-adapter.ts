import { expandChatTagReferences } from "../chat-tag-references";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isTeamRealtimeEvent, type TeamRealtimeEvent } from "../ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { restoreBrowserSecretMetadata } from "./browser-secret-v1";
import { eventConversationKey, withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import {
  toCurrentAgentKeys,
  toCurrentAgentKeysObjectForPath,
  toWireAgentKeys,
  toWireAgentKeysObjectForPath,
} from "./current-agent-keys";
import { withQuestionMultiSelect } from "./question-multi-select-v6";
import { withQuietTurn } from "./turn-quiet-v6";
import {
  decodeTeamProtocolV6BaseEvent,
  decodeTeamProtocolV6BaseHttpRequest,
  decodeTeamProtocolV6BaseHttpResponse,
  encodeTeamProtocolV6BaseEvent,
  type TeamProtocolV6BaseEventDecodeResult,
  type TeamProtocolV6BaseJsonObject,
  type TeamProtocolV6BaseJsonValue,
} from "./v6-base";

export type TeamProtocolV6BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV6BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV6BaseCurrentEvent(value: unknown): TeamProtocolV6BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
    const wireValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(value));
    const current = toCurrentAgentKeys(wireValue);
    return isAgentEvent(current) ? { kind: "known", event: current } : { kind: "invalid", type: value.type };
  }
  const decoded = decodeTeamProtocolV6BaseEvent(value);
  if (decoded.kind !== "known") return decoded;
  const decodedValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(decoded.event));
  let current: unknown;
  try {
    current = withEventQuestionMultiSelect(
      withQuietTurn(
        withEventConversationPlans(restoreBrowserSecretMetadata(toCurrentAgentKeys(decodedValue), value), value),
        value,
      ),
      value,
    );
  } catch {
    return { kind: "invalid", type: decoded.event.type };
  }
  return isAgentEvent(current) || isTeamRealtimeEvent(current)
    ? { kind: "known", event: current }
    : { kind: "invalid", type: decoded.event.type };
}

export function encodeTeamProtocolV6BaseCurrentEvent(
  event: AgentEvent | TeamRealtimeEvent,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
): string | null {
  if (event.type === "turn-progress") return JSON.stringify(toWireAgentKeys(JSON.parse(JSON.stringify(event))));
  const currentValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(event));
  const wireValue = toWireAgentKeys(currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  const decoded = decodeTeamProtocolV6BaseEvent(downconvertedValue);
  if (decoded.kind !== "known") return null;
  const encoded = encodeTeamProtocolV6BaseEvent(decoded.event);
  if (
    !encoded ||
    (!options.preserveBrowserSecrets &&
      !eventConversationKey(event.type) &&
      event.type !== "turn-completed" &&
      event.type !== "prompt")
  )
    return encoded;
  const output = withEventQuestionMultiSelect(
    withQuietTurn(withEventConversationPlans(JSON.parse(encoded), wireValue), wireValue),
    withoutFalseMultiSelect(wireValue),
  );
  return JSON.stringify(options.preserveBrowserSecrets ? restoreBrowserSecretMetadata(output, wireValue) : output);
}

/** Puts `multiSelect` beside the frozen questions of a conversation event or a `prompt` event. */
function withEventQuestionMultiSelect(
  projected: TeamProtocolV6BaseJsonValue,
  source: unknown,
): TeamProtocolV6BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  if (projected.type === "prompt") return withQuestionMultiSelect(projected, source);
  const key = eventConversationKey(projected.type);
  const conversation = key ? projected[key] : undefined;
  if (!key || conversation === undefined) return projected;
  return { ...projected, [key]: withQuestionMultiSelect(conversation, source[key]) };
}

/**
 * The host types allow `multiSelect: false`, but the frozen v6 marker accepts only `true` and
 * throws on any other value. Leave a `false` out before the encoder reads it: absent and `false`
 * both mean one choice, so the wire meaning does not change.
 */
export function withoutFalseMultiSelect(value: TeamProtocolV6BaseJsonValue): TeamProtocolV6BaseJsonValue {
  if (Array.isArray(value)) return value.map(withoutFalseMultiSelect);
  if (!isDynamicRecord(value)) return value;
  const result: TeamProtocolV6BaseJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "multiSelect" && entry === false) continue;
    result[key] = withoutFalseMultiSelect(entry);
  }
  return result;
}

/**
 * Puts the plans and the senders of a conversation event beside its frozen projection. See
 * `withConversationPlans` and `withConversationSenders`.
 */
function withEventConversationPlans(
  projected: TeamProtocolV6BaseJsonValue,
  source: unknown,
): TeamProtocolV6BaseJsonValue {
  if (projected === null || Array.isArray(projected) || typeof projected !== "object") return projected;
  if (!isDynamicRecord(source)) return projected;
  const key = eventConversationKey(projected.type);
  const conversation = key ? projected[key] : undefined;
  if (!key || conversation === undefined) return projected;
  return {
    ...projected,
    [key]: withConversationSenders(withConversationPlans(conversation, source[key]), source[key]),
  };
}

export function encodeTeamProtocolV6BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV6BaseHttpRequest(method, path, downconvertedValue));
}

export function decodeTeamProtocolV6BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV6BaseJsonObject {
  return toCurrentAgentKeysObjectForPath(
    path,
    structuredClone(decodeTeamProtocolV6BaseHttpRequest(method, path, value)),
  );
}

export function encodeTeamProtocolV6BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  if (status < 400 && isInstalledSkillsRoute(method, path)) return JSON.stringify(wireValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV6BaseHttpResponse(method, path, status, downconvertedValue));
}

function downconvertCurrentTags(value: TeamProtocolV6BaseJsonValue, key = ""): TeamProtocolV6BaseJsonValue {
  if (isString(value)) return key === "text" || key === "preview" ? expandChatTagReferences(value) : value;
  if (Array.isArray(value)) return value.map((item) => downconvertCurrentTags(item));
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  const result: TeamProtocolV6BaseJsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = downconvertCurrentTags(entryValue, entryKey);
  }
  return result;
}

export function decodeTeamProtocolV6BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV6BaseJsonValue {
  if (status < 400 && isInstalledSkillsRoute(method, path)) {
    const wireValue: TeamProtocolV6BaseJsonValue = JSON.parse(JSON.stringify(value));
    return toCurrentAgentKeysForResponsePath(path, structuredClone(wireValue));
  }
  return toCurrentAgentKeysForResponsePath(
    path,
    structuredClone(decodeTeamProtocolV6BaseHttpResponse(method, path, status, value)),
  );
}

function isInstalledSkillsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/skills$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

function toWireAgentKeysForRequestPath(path: string, value: TeamProtocolV6BaseJsonValue): TeamProtocolV6BaseJsonValue {
  return isDynamicRecord(value) ? toWireAgentKeysObjectForPath(path, value) : toWireAgentKeys(value);
}

function toCurrentAgentKeysForResponsePath(
  path: string,
  value: TeamProtocolV6BaseJsonValue,
): TeamProtocolV6BaseJsonValue {
  return isDynamicRecord(value) ? toCurrentAgentKeysObjectForPath(path, value) : toCurrentAgentKeys(value);
}
