import {
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  REMOTE_DESKTOP_PERMISSION_APPS,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

export function decodeRemoteDesktopSetupFromHost(value: unknown): RemoteDesktopSetupStatus {
  // A newer host can name an app that this version does not know. Drop that name, not the response.
  const known =
    isDynamicRecord(value) && !isOneOf(REMOTE_DESKTOP_PERMISSION_APPS, value.permissionApp)
      ? { ...value, permissionApp: undefined }
      : value;
  if (!isRemoteDesktopSetupStatus(known)) throw new Error("Invalid remote desktop setup response.");
  return { ...known };
}

export function decodeRemoteDesktopTestFromHost(value: unknown): RemoteDesktopTestStatus {
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}
