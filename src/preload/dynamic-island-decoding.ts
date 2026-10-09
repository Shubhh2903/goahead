// What main answers for the Dynamic Island: its preference, geometry, presentation and actions.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type DynamicIslandAction,
  type DynamicIslandGaze,
  type DynamicIslandGeometry,
  type DynamicIslandPreference,
  type DynamicIslandPresentation,
  isDynamicIslandAction,
  isDynamicIslandGaze,
  isDynamicIslandNotchSize,
  isDynamicIslandPreference,
  isDynamicIslandPresentation,
} from "@openbot/contracts/ipc";

export function decodeDynamicIslandPreference(value: unknown): DynamicIslandPreference {
  if (!isDynamicIslandPreference(value)) throw new Error("Invalid Dynamic Island preference response.");
  return value;
}

export function decodeDynamicIslandGeometry(value: unknown): DynamicIslandGeometry {
  if (value === null) return null;
  if (!isDynamicIslandNotchSize(value)) throw new Error("Invalid Dynamic Island geometry.");
  return value;
}

export function decodeDynamicIslandGaze(value: unknown): DynamicIslandGaze {
  if (!isDynamicIslandGaze(value)) throw new Error("Invalid Dynamic Island gaze.");
  return value;
}

export function decodeDynamicIslandPresentation(value: unknown): DynamicIslandPresentation {
  if (!isDynamicIslandPresentation(value)) throw new Error("Invalid Dynamic Island presentation.");
  return value;
}

export function decodeDynamicIslandAction(value: unknown): DynamicIslandAction {
  if (isDynamicIslandAction(value)) return value;
  throw new Error("Invalid Dynamic Island action.");
}
