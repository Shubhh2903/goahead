// The ACP registry of this computer. No Team API route reaches it: a registry agent is a command
// that runs here. `registerIpcGroups` checks the sender before any payload is decoded.

import { parseRegistryId, parseRegistryInstall, parseRegistryQuery } from "@openbot/contracts/ipc";
import type { AcpRegistry } from "../acp-registry";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function acpRegistryIpcHandlers(registry: AcpRegistry): Pick<IpcGroupHandlers, "acpRegistry"> {
  return {
    acpRegistry: {
      search: payloadHandler(parseRegistryQuery, (query) => registry.search(query)),
      installed: handler(() => registry.listInstalled()),
      status: handler(() => registry.status()),
      install: payloadHandler(parseRegistryInstall, (input) => registry.install(input)),
      cancel: payloadHandler(parseRegistryId, (registryId) => registry.cancel(registryId)),
      remove: payloadHandler(parseRegistryId, (registryId) => registry.uninstall(registryId)),
    },
  };
}
