import { hostedPlanDisk } from "@openbot/contracts/hosted-servers";
import {
  LOCAL_SERVER_ID,
  type RemovableRuntimes,
  type StorageDisk,
  type TeamMemberSummary,
  type UnassignedFolder,
} from "@openbot/contracts/ipc";
import { MachineResources } from "@openbot/ui/features/files/MachineResources";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { BackgroundProcessesSection } from "@openbot/ui/features/settings/BackgroundProcessesSection";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { type FilesPort, filesPort } from "./files-port";
import { createMachineResources } from "./machine-resources";
import { createServerBackgroundProcesses } from "./server-background-processes";
import { createServerAgents, createStorageUsage } from "./storage-usage";

export interface ServerStorageOptions {
  hostName: string;
  canManage: boolean;
  onOpenAgent: (agentId: string) => void;
  onShowMessage: (agentId: string, messageId: string) => void;
  members?: readonly TeamMemberSummary[];
  calls?: FilesPort;
  backgroundProcesses?: boolean;
}

export function ServerStoragePanel(
  props: ServerStorageOptions & {
    serverId: string;
    storageGb?: number | null;
  },
) {
  const calls = () => props.calls ?? filesPort();
  const storage = createStorageUsage(() => ({ serverId: props.serverId, input: { scope: "host" } }), calls);
  const machine = createMachineResources(() => ({ serverId: props.serverId, canManage: props.canManage }), calls);
  const agents = createServerAgents(() => props.serverId, calls);
  const processes = createServerBackgroundProcesses(
    () => ({
      serverId: props.serverId,
      shown: props.canManage && props.backgroundProcesses === true && calls().backgroundProcesses !== undefined,
    }),
    calls,
  );

  const runtimes = () => {
    const { getRemovableRuntimes, removeRemovableRuntimes } = calls().storage;
    return props.serverId === LOCAL_SERVER_ID && getRemovableRuntimes && removeRemovableRuntimes
      ? { getRemovableRuntimes, removeRemovableRuntimes }
      : undefined;
  };
  const noRuntimes: RemovableRuntimes = { bytes: 0, providers: [] };
  const [removableRuntimes, setRemovableRuntimes] = createSignal<RemovableRuntimes>(noRuntimes);
  createEffect(
    () => [storage.state.usage, runtimes()] as const,
    ([scan, port]) => {
      if (!scan || !port) return;
      let current = true;
      port
        .getRemovableRuntimes()
        .then((removable) => {
          if (current) setRemovableRuntimes(removable);
        })
        .catch(() => {
          if (current) setRemovableRuntimes(noRuntimes);
        });
      return () => {
        current = false;
      };
    },
  );

  async function removeRuntimes(): Promise<void> {
    const port = runtimes();
    if (!port) return;
    try {
      setRemovableRuntimes(await port.removeRemovableRuntimes());
    } finally {
      await storage.refresh(true);
    }
  }

  const [disk, setDisk] = createSignal<{ scan: unknown; disk: StorageDisk } | null>(null);
  createEffect(
    () => [storage.state.usage, props.storageGb, calls().storage.getDisk] as const,
    ([scan, storageGb, getDisk]) => {
      if (!scan || !storageGb || !getDisk) return;
      let current = true;
      getDisk(props.serverId)
        .then((answer) => {
          if (current) setDisk(answer ? { scan, disk: answer } : null);
        })
        .catch(() => {
          if (current) setDisk(null);
        });
      return () => {
        current = false;
      };
    },
  );
  const freeBytes = () => {
    const scan = storage.state.usage;
    const read = disk();
    if (!scan) return null;
    return props.storageGb && read?.scan === scan
      ? hostedPlanDisk(read.disk, props.storageGb).freeBytes
      : scan.freeBytes;
  };

  const usage = () => storage.state.usage;

  // Folders with no agent are paths on this computer: only the local host lists them, and only
  // where the port can move one to the Trash.
  const folderCalls = () => {
    const { listUnassignedFolders, trashUnassignedFolder } = calls().storage;
    return props.serverId === LOCAL_SERVER_ID && listUnassignedFolders && trashUnassignedFolder
      ? { list: listUnassignedFolders, trash: trashUnassignedFolder }
      : null;
  };
  const [folders, setFolders] = createSignal<UnassignedFolder[]>([]);
  // Read again after each scan; the host answers from the same scan, so this is quick.
  createEffect(
    () => usage()?.scannedAt ?? null,
    (scannedAt) => {
      let current = true;
      const port = untrack(folderCalls);
      if (!scannedAt || !port) setFolders([]);
      else
        port
          .list()
          .then((list) => {
            if (current) setFolders(list);
          })
          // The section only hides; the storage read reports its own failure.
          .catch(() => {
            if (current) setFolders([]);
          });
      return () => {
        current = false;
      };
    },
  );

  return (
    <StorageOverview
      hostName={props.hostName}
      state={storage.scanState()}
      error={storage.error()}
      scannedAt={usage()?.scannedAt ?? null}
      breakdown={usage()?.breakdown ?? []}
      freeBytes={freeBytes()}
      hostedPlan={Boolean(props.storageGb)}
      agents={agents() ?? []}
      agentUsage={usage()?.agents ?? []}
      conversations={usage()?.conversations ?? []}
      files={usage()?.files ?? []}
      canManage={props.canManage}
      onRescan={() => void storage.refresh(true)}
      onOpenAgent={props.onOpenAgent}
      onOpenConversation={(conversationId) => {
        const agentId = usage()?.conversations.find((chat) => chat.id === conversationId)?.agentId;
        if (agentId) props.onOpenAgent(agentId);
      }}
      onClear={storage.clear}
      runtimeBytes={runtimes() ? removableRuntimes().bytes : 0}
      runtimeProviders={removableRuntimes().providers}
      onRemoveRuntimes={removeRuntimes}
      unassignedFolders={folders()}
      onTrashFolder={
        folderCalls()
          ? async (path) => {
              try {
                await folderCalls()?.trash({ path });
              } finally {
                await storage.refresh(true);
              }
            }
          : undefined
      }
      // Settings has no preview pane, so a preview opens the file in its app.
      onPreviewFile={(file) => void storage.fileAction(file, "open", { onShowInChat: () => undefined })}
      machine={
        <>
          <Show when={machine.state.available}>
            <MachineResources
              metrics={machine.state.metrics}
              error={machine.state.error}
              alerts={machine.state.alerts}
              members={props.members ?? []}
              onChangeAlerts={machine.saveAlerts}
            />
          </Show>
          <Show when={processes.state.processes}>
            {(list) => (
              <BackgroundProcessesSection
                processes={list()}
                loadFailed={processes.state.loadFailed}
                agents={processes.state.agents}
                stopping={processes.state.stopping}
                onStop={processes.stop}
              />
            )}
          </Show>
        </>
      }
      onFileAction={(file, action) =>
        storage.fileAction(file, action, {
          onShowInChat: (row) => {
            if (row.agentId && row.messageId) props.onShowMessage(row.agentId, row.messageId);
          },
        })
      }
    />
  );
}
