import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV6BaseJsonObject, TeamProtocolV6BaseJsonValue } from "./v6-base";

/**
 * `multiSelect` rides beside the frozen prompt-question projection, in the way `plan`, `senderMember`
 * and `quiet` do: the shipped key lists drop it, so a client on protocol 1-6 that predates it reads
 * the question as a single choice, where one tap sends one option and a typed reply still works.
 * The answer wire needs no change, because every answer is already a list of strings.
 *
 * Only `true` is a value; the host leaves the key out otherwise. The projection removes the key,
 * so an unchecked value would reach the client as a flag the contract never allowed. Fail closed
 * instead: any other present value is a protocol error.
 */
function markedQuestions(projected: unknown, source: unknown): TeamProtocolV6BaseJsonValue {
  if (!Array.isArray(projected) || !Array.isArray(source)) return Array.isArray(projected) ? projected : [];
  return projected.map((question, index) => {
    const original = source[index];
    if (!isDynamicRecord(question) || !isDynamicRecord(original) || original.multiSelect === undefined) return question;
    if (original.multiSelect !== true) throw new Error("Invalid multi-select question marker.");
    if (original.id !== question.id) return question;
    return { ...question, multiSelect: true };
  });
}

function withPromptQuestions(
  holder: TeamProtocolV6BaseJsonObject,
  source: unknown,
  key: string,
): TeamProtocolV6BaseJsonObject {
  if (!isDynamicRecord(source) || !Array.isArray(holder[key])) return holder;
  return { ...holder, [key]: markedQuestions(holder[key], source[key]) };
}

function withMessageQuestions(
  projected: TeamProtocolV6BaseJsonValue,
  sources: Map<string, unknown>,
): TeamProtocolV6BaseJsonValue {
  if (!isDynamicRecord(projected) || !isString(projected.id) || !isDynamicRecord(projected.questionPrompt)) {
    return projected;
  }
  const source = sources.get(projected.id);
  if (source === undefined) return projected;
  return { ...projected, questionPrompt: withPromptQuestions(projected.questionPrompt, source, "questions") };
}

/** The questions of a conversation snapshot or page, and of a `prompt` event. */
export function withQuestionMultiSelect(
  projected: TeamProtocolV6BaseJsonValue,
  source: unknown,
): TeamProtocolV6BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  if (projected.type === "prompt") return withPromptQuestions(projected, source, "questions");
  const sources = new Map<string, unknown>();
  for (const message of [
    ...(Array.isArray(source.messages) ? source.messages : []),
    ...(isDynamicRecord(source.references) ? Object.values(source.references) : []),
  ]) {
    if (isDynamicRecord(message) && isString(message.id) && isDynamicRecord(message.questionPrompt)) {
      sources.set(message.id, message.questionPrompt);
    }
  }
  if (sources.size === 0) return projected;
  const result: TeamProtocolV6BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map((m) => withMessageQuestions(m, sources));
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withMessageQuestions(value, sources)]),
    );
  }
  return result;
}
