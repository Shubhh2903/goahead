// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type {
  OpenBotDesktopApi,
  RoutineFields,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineRunCondition,
  RoutineRunFields,
  RoutineSchedule,
} from "@openbot/contracts/ipc";

interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  /** Left out, an update keeps the saved policy. */
  limitPolicy?: RoutineLimitPolicy;
  /** Left out, an update keeps the saved policy. */
  missedPolicy?: RoutineMissedPolicy;
  /** Left out, an update keeps the saved condition; `null` removes it. */
  runCondition?: RoutineRunCondition | null;
}

export interface RoutinesPort {
  ownerId: string;
  /** The word the editor reads in its placeholder: "Describe what this agent should do." */
  ownerNoun: "agent" | "channel";
  /**
   * Whether the host keeps what a routine does at a spent plan. Only this computer's host does: the
   * released Team API drops the field, so a remote host would ignore the choice.
   */
  limitPolicy: boolean;
  /**
   * Whether the host keeps what a routine does with a run that came due while GoAhead was closed.
   * Only this computer's host does, for the same reason as `limitPolicy`.
   */
  missedPolicy: boolean;
  /**
   * Whether the host can check a run condition before a scheduled run. Only this computer's host
   * does: the command runs on the host, and the released Team API drops the field.
   */
  runCondition: boolean;
  list: () => Promise<RoutineFields[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineFields>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  /** Only for an agent on this computer that allows local scripts. */
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
}

export function agentRoutinesPort(agentId: string, automation = false, localHost = false): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    limitPolicy: localHost,
    missedPolicy: localHost,
    runCondition: localHost,
    list: () => window.openbot.agent.listRoutines(agentId),
    listRuns: (routineId, limit) => window.openbot.agent.listRoutineRuns({ agentId, routineId, limit }),
    save: (input) => {
      const { routineId, name, instruction, active, timezone, schedule } = input;
      return routineId
        ? window.openbot.agent.updateRoutine({
            agentId,
            routineId,
            name,
            instruction,
            active,
            schedule,
            ...updatePolicy(localHost, input),
          })
        : window.openbot.agent.createRoutine({
            agentId,
            name,
            instruction,
            active,
            timezone,
            schedule,
            ...createPolicy(localHost, input),
          });
    },
    remove: (routineId) => window.openbot.agent.deleteRoutine({ agentId, routineId }),
    test: async (routineId) => {
      await window.openbot.agent.testRoutine({ agentId, routineId });
    },
    ...(automation
      ? { runCommand: (routineId: string) => window.openbot.agent.automationRunCommand({ agentId, routineId }) }
      : {}),
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "routines-changed" && event.agentId === agentId) reload();
      }),
  };
}

/** The host calls a channel's routines make. The desktop sends them through preload. */
export type ChannelRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listChannelRoutines"
  | "listChannelRoutineRuns"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "onEvent"
>;

export function channelRoutinesPort(
  channelId: string,
  api: ChannelRoutinesApi = window.openbot.agent,
  localHost = false,
): RoutinesPort {
  return {
    ownerId: channelId,
    ownerNoun: "channel",
    limitPolicy: localHost,
    missedPolicy: localHost,
    runCondition: localHost,
    list: () => api.listChannelRoutines(channelId),
    listRuns: (routineId, limit) => api.listChannelRoutineRuns({ channelId, routineId, limit }),
    save: (input) => {
      const { routineId, name, instruction, active, timezone, schedule } = input;
      return routineId
        ? api.updateChannelRoutine({
            channelId,
            routineId,
            name,
            instruction,
            active,
            schedule,
            ...updatePolicy(localHost, input),
          })
        : api.createChannelRoutine({
            channelId,
            name,
            instruction,
            active,
            timezone,
            schedule,
            ...createPolicy(localHost, input),
          });
    },
    remove: (routineId) => api.deleteChannelRoutine({ channelId, routineId }),
    test: async (routineId) => {
      await api.testChannelRoutine({ channelId, routineId });
    },
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "channel-routines-changed" && event.channelId === channelId) reload();
      }),
  };
}

/** The fields only this computer's host keeps, for a new routine: no condition is left out. */
function createPolicy(
  localHost: boolean,
  { limitPolicy, missedPolicy, runCondition }: RoutineSaveInput,
): { limitPolicy?: RoutineLimitPolicy; missedPolicy?: RoutineMissedPolicy; runCondition?: RoutineRunCondition } {
  if (!localHost) return {};
  return {
    ...(limitPolicy ? { limitPolicy } : {}),
    ...(missedPolicy ? { missedPolicy } : {}),
    ...(runCondition ? { runCondition } : {}),
  };
}

/** The same fields for an update, where `null` removes the saved condition. */
function updatePolicy(
  localHost: boolean,
  input: RoutineSaveInput,
): { limitPolicy?: RoutineLimitPolicy; missedPolicy?: RoutineMissedPolicy; runCondition?: RoutineRunCondition | null } {
  return {
    ...createPolicy(localHost, input),
    ...(localHost && input.runCondition === null ? { runCondition: null } : {}),
  };
}
