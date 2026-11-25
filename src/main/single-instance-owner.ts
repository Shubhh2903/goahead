import { readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const SINGLETON_LOCK_FILE = "SingletonLock";

export function singleInstanceOwnerPid(userDataPath: string): number | null {
  let target: string;
  try {
    target = readlinkSync(join(userDataPath, SINGLETON_LOCK_FILE));
  } catch {
    return null;
  }
  const prefix = `${hostname()}-`;
  if (!target.startsWith(prefix)) return null;
  const pid = target.slice(prefix.length);
  return /^[1-9][0-9]*$/u.test(pid) ? Number(pid) : null;
}

export function singleInstanceExitMessage(ownerPid: number | null): string {
  const owner = ownerPid === null ? "Another GoAhead" : `Another GoAhead (process ${ownerPid})`;
  return `${owner} uses this data folder. This start sends its request to that GoAhead and stops.`;
}
