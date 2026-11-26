// What main answers for the Usage tab of this computer. It has no host twin: the Usage tab reads
// only the local database, and no Team API route carries it.

import { decodeUsageDashboard, type UsageDashboard } from "@openbot/contracts/ipc";

export function decodeLocalUsageDashboard(value: unknown): UsageDashboard {
  return decodeUsageDashboard(value);
}
