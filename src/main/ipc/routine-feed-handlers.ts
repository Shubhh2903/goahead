// The iCalendar feed of this computer's routines. It is local only: the feed listens on this computer.

import type { RoutineFeedServer } from "../routine-feed-server";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

export interface RoutineFeedIpcDependencies {
  routineFeed: RoutineFeedServer;
}

export function routineFeedIpcHandlers({
  routineFeed,
}: RoutineFeedIpcDependencies): Pick<IpcGroupHandlers, "routineFeed"> {
  return {
    routineFeed: {
      get: handler(() => routineFeed.status()),
      create: handler(() => routineFeed.create()),
      remove: handler(() => routineFeed.remove()),
    },
  };
}
