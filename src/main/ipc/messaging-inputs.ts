// The messaging payloads. No message here quotes the input.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddSlackOrchestratorInput,
  MarkMessagingThreadReadInput,
  MessagingThreadPageInput,
  SetSlackEnabledInput,
  SetSlackWatchedChannelsInput,
  SlackWorkspaceInput,
} from "@openbot/contracts/ipc";
import {
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  isSlackChannelChoice,
  MESSAGING_LIMITS,
} from "@openbot/contracts/ipc";
import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { parsePageAnchor, parsePageLimit } from "./agent-inputs";
import { isObject, requireString } from "./validation";

export function parseSlackWorkspaceInput(value: unknown): SlackWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetSlackEnabledInput(value: unknown): SetSlackEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseAddSlackOrchestratorInput(value: unknown): AddSlackOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddSlackOrchestratorInput = { workspaceId: requireString(value.workspaceId, "Workspace id") };
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) throw new Error("A messaging request is invalid.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("A messaging request is invalid.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("A messaging request is invalid.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

export function parseMessagingThreadPageInput(value: unknown): MessagingThreadPageInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    threadId: requireString(value.threadId, "Thread id", INPUT_LIMITS.identifier),
    anchor: parsePageAnchor(value.anchor),
    limit: parsePageLimit(value.limit),
  };
}

export function parseMarkMessagingThreadReadInput(value: unknown): MarkMessagingThreadReadInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const throughMessageId = value.throughMessageId;
  if (throughMessageId !== null && !isString(throughMessageId)) throw new Error("A messaging request is invalid.");
  return {
    threadId: requireString(value.threadId, "Thread id", INPUT_LIMITS.identifier),
    throughMessageId:
      throughMessageId === null ? null : requireString(throughMessageId, "Message id", INPUT_LIMITS.identifier),
  };
}

export function parseSetSlackWatchedChannelsInput(value: unknown): SetSlackWatchedChannelsInput {
  if (
    !isObject(value) ||
    !Array.isArray(value.channels) ||
    value.channels.length > MESSAGING_LIMITS.watchedChannels ||
    !value.channels.every(isSlackChannelChoice)
  )
    throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    channels: value.channels.map((channel) => ({ channelId: channel.channelId, name: channel.name })),
  };
}
