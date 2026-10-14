// Managed installations from the ACP registry, on this computer only. A registry agent becomes a
// saved custom agent whose command points at the staged files; agent identity, credentials and
// conversations belong to the custom agent store and the backend, never to this module.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AcpRegistryDistribution,
  AcpRegistryEntry,
  AcpRegistryInstallation,
  AcpRegistryInstallInput,
  AcpRegistryOperation,
  CustomAgentResult,
  CustomAgentSummary,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { ACP_REGISTRY_DISTRIBUTIONS, isNewCustomAgentId } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { AcpRegistryError, type RegistryAgent, readAcpRegistry } from "./acp-registry-catalog";
import {
  type PrepareRegistryAgent,
  prepareRegistryAgent,
  type RegistryPrepared,
  registryDistributions,
} from "./acp-registry-install";
import type { CustomAgentChanges } from "./custom-agent-changes";

interface Installed {
  registryId: string;
  customAgentId: string;
  version: string;
  distribution: AcpRegistryDistribution;
  removed?: boolean;
  generation: string;
  command: string;
}

function isInstalled(value: unknown): value is Installed {
  return (
    isDynamicRecord(value) &&
    isString(value.registryId) &&
    isString(value.customAgentId) &&
    isString(value.version) &&
    isOneOf(ACP_REGISTRY_DISTRIBUTIONS, value.distribution) &&
    (value.removed === undefined || typeof value.removed === "boolean") &&
    isString(value.generation) &&
    /^[a-f0-9-]{36}$/u.test(value.generation) &&
    isString(value.command)
  );
}

interface Operation {
  controller: AbortController;
  done: Promise<void>;
  committing: boolean;
}

export interface AcpRegistryDependencies {
  /** The application data folder. Installations live in `acp-registry/` under it. */
  directory: string;
  customAgentChanges: Pick<CustomAgentChanges, "list" | "saveIfUnchanged" | "remove">;
  /** The host stops the idle ACP runtime, and refuses while it works, before files are removed. */
  withRuntimeRemoval: (customAgentIds: readonly string[], operation: () => Promise<void>) => Promise<void>;
  catalog?: (signal?: AbortSignal) => Promise<RegistryAgent[]>;
  prepare?: PrepareRegistryAgent;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : sourceText("error.provider.registryInstallFailed");
}

/** Owns managed ACP installations only. Agent identity, credentials, and history belong elsewhere. */
export class AcpRegistry {
  readonly #root: string;
  readonly #dependencies: AcpRegistryDependencies;
  readonly #removing = new Set<string>();
  readonly #active = new Map<string, Operation>();
  readonly #status = new Map<string, AcpRegistryOperation>();
  readonly #catalog: (signal?: AbortSignal) => Promise<RegistryAgent[]>;
  readonly #prepare: PrepareRegistryAgent;
  /** One commit or removal at a time, from the record read to the record write. */
  #gate: Promise<unknown> = Promise.resolve();

  constructor(dependencies: AcpRegistryDependencies) {
    this.#dependencies = dependencies;
    this.#root = join(dependencies.directory, "acp-registry");
    this.#catalog = dependencies.catalog ?? readAcpRegistry;
    this.#prepare = dependencies.prepare ?? prepareRegistryAgent;
  }

  #withGate<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.#gate.then(run);
    this.#gate = operation.catch(() => undefined);
    return operation;
  }

  async #records(): Promise<Installed[]> {
    let source: string;
    try {
      source = await readFile(join(this.#root, "installed.json"), "utf8");
    } catch (error) {
      if (isDynamicRecord(error) && error.code === "ENOENT") return [];
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new AcpRegistryError(sourceText("error.provider.registryInvalid"), { cause: error });
    }
    if (!Array.isArray(raw) || !raw.every(isInstalled))
      throw new AcpRegistryError(sourceText("error.provider.registryInvalid"));
    return raw;
  }

  async #write(records: readonly Installed[]): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const temporary = join(this.#root, `installed-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      await rename(temporary, join(this.#root, "installed.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** The records whose command is still the saved custom agent's command. */
  async #bound(): Promise<Installed[]> {
    const agents = await this.#dependencies.customAgentChanges.list();
    return (await this.#records()).filter((record) =>
      agents.some((agent) => agent.id === record.customAgentId && agent.command === record.command),
    );
  }

  async listInstalled(): Promise<AcpRegistryInstallation[]> {
    return (await this.#bound())
      .filter((record) => !record.removed)
      .map(({ registryId, customAgentId, version, distribution }) => ({
        registryId,
        customAgentId,
        version,
        distribution,
      }));
  }

  async search(query = ""): Promise<AcpRegistryEntry[]> {
    const installed = await this.listInstalled();
    const entries = await this.#catalog();
    const bindings = await this.#bound();
    const needle = query.trim().toLowerCase();
    return entries
      .filter((entry) => !needle || `${entry.name} ${entry.id} ${entry.description}`.toLowerCase().includes(needle))
      .map((entry) => {
        const local = installed.find((record) => record.registryId === entry.id);
        return {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          description: entry.description,
          website: entry.website ?? null,
          license: entry.license ?? null,
          distributions: registryDistributions(entry),
          installedVersion: local?.version ?? null,
          customAgentId:
            local?.customAgentId ?? bindings.find((record) => record.registryId === entry.id)?.customAgentId ?? null,
        };
      });
  }

  status(): AcpRegistryOperation[] {
    return [...this.#status.values()];
  }

  /** Stops an installation that has not started to switch the command. */
  cancel(registryId: string): void {
    const operation = this.#active.get(registryId);
    if (operation && !operation.committing) operation.controller.abort();
  }

  /** Cancels every installation that can still stop, and waits for all of them. */
  async close(): Promise<void> {
    const active = [...this.#active.values()];
    for (const operation of active) if (!operation.committing) operation.controller.abort();
    await Promise.all(active.map((operation) => operation.done));
  }

  /** Installs or updates one registry agent. A failed or cancelled run keeps the previous command. */
  async install(input: AcpRegistryInstallInput): Promise<CustomAgentResult> {
    if (this.#active.has(input.registryId) || this.#removing.has(input.registryId))
      throw new AcpRegistryError(sourceText("error.provider.registryBusy"));
    let finish = () => {};
    const operation: Operation = {
      controller: new AbortController(),
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      committing: false,
    };
    this.#active.set(input.registryId, operation);
    this.#status.set(input.registryId, { registryId: input.registryId, state: "installing", message: null });
    try {
      const result = await this.#install(input, operation);
      this.#status.delete(input.registryId);
      return result;
    } catch (error) {
      if (operation.controller.signal.aborted) {
        this.#status.delete(input.registryId);
        throw new AcpRegistryError(sourceText("error.provider.registryCancelled"), { cause: error });
      }
      this.#status.set(input.registryId, {
        registryId: input.registryId,
        state: "failed",
        message: redactText(errorMessage(error)),
      });
      throw error;
    } finally {
      this.#active.delete(input.registryId);
      finish();
    }
  }

  async #install(input: AcpRegistryInstallInput, operation: Operation): Promise<CustomAgentResult> {
    const signal = operation.controller.signal;
    const catalog = await this.#catalog(signal);
    const entry = catalog.find((agent) => agent.id === input.registryId);
    if (!entry) throw new AcpRegistryError(sourceText("error.provider.registryMissing"));
    const distribution = input.distribution ?? registryDistributions(entry)[0];
    if (!distribution || !registryDistributions(entry).includes(distribution))
      throw new AcpRegistryError(sourceText("error.provider.registryMissing"));
    const old =
      (await this.#dependencies.customAgentChanges.list()).find((agent) => agent.id === input.customAgentId) ?? null;
    if (!old && !isNewCustomAgentId(input.customAgentId))
      throw new AcpRegistryError(sourceText("error.provider.customAgentIdInvalid"));
    const records = await this.#records();
    // An update replaces only a command that this registry installed for the same agent.
    if (
      old &&
      !records.some(
        (record) => record.registryId === entry.id && record.customAgentId === old.id && record.command === old.command,
      )
    )
      throw new AcpRegistryError(sourceText("error.provider.registryBindingChanged"));
    const generation = randomUUID();
    const folder = join(this.#root, "versions", generation);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    let activated = false;
    try {
      let prepared: RegistryPrepared;
      try {
        prepared = await this.#prepare(entry, distribution, folder, signal);
      } catch (error) {
        throw new AcpRegistryError(redactText(maskRegistryEnv(errorMessage(error), entry, distribution)), {
          cause: error,
        });
      }
      const inputToSave: SaveCustomAgentInput = {
        id: input.customAgentId,
        name: old?.name ?? input.name ?? (entry.name.trim() || entry.id).slice(0, INPUT_LIMITS.agentName),
        command: prepared.command,
        args: prepared.args,
        env: Object.entries(prepared.env).map(([name, value]) => ({ name, value })),
      };
      const record: Installed = {
        registryId: entry.id,
        customAgentId: input.customAgentId,
        version: entry.version,
        distribution,
        generation,
        command: prepared.command,
      };
      return await this.#withGate(async () => {
        if (signal.aborted) throw new AcpRegistryError(sourceText("error.provider.registryCancelled"));
        operation.committing = true;
        // Journal the candidate before switching the command. After a crash, only the record whose
        // command matches the saved custom agent is displayed as installed.
        await this.#write([...(await this.#records()), record]);
        let result: CustomAgentResult;
        try {
          result = await this.#dependencies.customAgentChanges.saveIfUnchanged(inputToSave, old);
        } catch (error) {
          await this.#rollback(record, old, prepared).catch(() => undefined);
          throw error;
        }
        activated = true;
        return result;
      });
    } finally {
      if (!activated) await this.#discard(folder);
    }
  }

  /** Removes a staged folder unless a saved command still names it (a rollback that failed). */
  async #discard(folder: string): Promise<void> {
    const agents = await this.#dependencies.customAgentChanges.list().catch(() => null);
    if (!agents) return;
    if (agents.some((agent) => agent.command.startsWith(`${folder}/`) || agent.command.startsWith(`${folder}\\`)))
      return;
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }

  async #rollback(record: Installed, old: CustomAgentSummary | null, prepared: RegistryPrepared): Promise<void> {
    const current = (await this.#dependencies.customAgentChanges.list()).find(
      (agent) => agent.id === record.customAgentId,
    );
    if (current?.command === prepared.command) {
      if (old)
        await this.#dependencies.customAgentChanges.saveIfUnchanged(
          {
            id: old.id,
            name: old.name,
            command: old.command,
            args: old.args,
            env: old.envNames.map((name) => ({ name, value: null })),
          },
          current,
        );
      else await this.#dependencies.customAgentChanges.remove(record.customAgentId);
    }
    await this.#write((await this.#records()).filter((candidate) => candidate.generation !== record.generation));
  }

  /**
   * Removes the managed files of one registry agent. The saved custom agent, its settings, secrets,
   * workspaces and conversations stay; its command then no longer starts until it is reinstalled.
   */
  async uninstall(registryId: string): Promise<void> {
    if (this.#active.has(registryId)) throw new AcpRegistryError(sourceText("error.provider.registryRemoveBusy"));
    await this.#withGate(async () => {
      if (this.#active.has(registryId)) throw new AcpRegistryError(sourceText("error.provider.registryRemoveBusy"));
      this.#removing.add(registryId);
      try {
        const records = await this.#records();
        const removed = records.filter((record) => record.registryId === registryId);
        await this.#dependencies.withRuntimeRemoval(
          removed.map((record) => record.customAgentId),
          async () => {
            for (const record of removed)
              await rm(join(this.#root, "versions", record.generation), { recursive: true, force: true });
            await this.#write(
              records.map((record) => (record.registryId === registryId ? { ...record, removed: true } : record)),
            );
          },
        );
      } finally {
        this.#removing.delete(registryId);
      }
    });
  }
}

/** A registry environment value can be a default secret; mask it before a message is shown or logged. */
function maskRegistryEnv(message: string, entry: RegistryAgent, distribution: AcpRegistryDistribution): string {
  const targets =
    distribution === "binary"
      ? Object.values(entry.distribution.binary ?? {})
      : [distribution === "npx" ? entry.distribution.npx : entry.distribution.uvx];
  let masked = message;
  for (const target of targets)
    for (const secret of Object.values(target?.env ?? {}))
      if (secret.length >= 4) masked = masked.split(secret).join("•••");
  return masked;
}

export function createAcpRegistry(dependencies: AcpRegistryDependencies): AcpRegistry {
  return new AcpRegistry(dependencies);
}
