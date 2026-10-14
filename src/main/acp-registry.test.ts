import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createAcpRegistry } from "./acp-registry";
import type { RegistryAgent } from "./acp-registry-catalog";
import { prepareRegistryAgent, type RegistryPrepared } from "./acp-registry-install";
import { createCustomAgentChanges } from "./custom-agent-changes";
import { CustomAgentStore } from "./custom-agent-store";

// Failure modes: a download whose bytes differ from the published SHA-256 is activated; a cancelled
// update replaces a working command; runtime removal deletes the saved agent or its secrets.
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "openbot-registry-"));
  folders.push(folder);
  return folder;
}

async function setup() {
  const folder = await temporaryFolder();
  const store = new CustomAgentStore({
    path: join(folder, "agents.json"),
    cipher: { canPersist: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() },
    resolve: async (command) => command,
  });
  const changes = createCustomAgentChanges({
    customAgents: store,
    service: {
      saveCustomAgent: (persist) => persist(),
      removeCustomAgent: (_id, persist) => persist(),
      reloadCustomAgents: async () => "restarted",
    },
  });
  const entry: RegistryAgent = {
    id: "example",
    name: "Example",
    description: "Test",
    version: "1.0.0",
    distribution: { npx: { package: "example@1.0.0" } },
  };
  let suspend = false;
  let entered = () => {};
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const registry = createAcpRegistry({
    directory: folder,
    customAgentChanges: changes,
    withRuntimeRemoval: (_ids, operation) => operation(),
    catalog: async () => [entry],
    prepare: (_agent, _distribution, directory, signal) => {
      const prepared: RegistryPrepared = {
        command: join(directory, "runtime", "agent"),
        args: [],
        env: { TOKEN: "initial" },
      };
      if (!suspend) return Promise.resolve(prepared);
      entered();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });
  return {
    folder,
    store,
    registry,
    suspend: () => {
      suspend = true;
    },
    preparing,
  };
}

it("refuses a binary download whose SHA-256 differs from the registry entry", async () => {
  const folder = await temporaryFolder();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not the published bytes")),
  );
  const target = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const agent: RegistryAgent = {
    id: "example",
    name: "Example",
    description: "Test",
    version: "1.0.0",
    distribution: {
      binary: { [target]: { archive: "https://example.com/agent", cmd: "agent", sha256: "0".repeat(64) } },
    },
  };
  await expect(prepareRegistryAgent(agent, "binary", folder, new AbortController().signal)).rejects.toThrow(
    "The provider installation did not pass its integrity check.",
  );
  expect(await readdir(join(folder, "runtime"))).toEqual([]);
});

it("keeps the working command after a cancelled update", async () => {
  const a = await setup();
  const input = { registryId: "example", customAgentId: "example" };
  await a.registry.install(input);
  const original = a.store.configs()[0];
  a.suspend();
  const installing = a.registry.install(input);
  await a.preparing;
  a.registry.cancel("example");
  await expect(installing).rejects.toThrow("The agent installation was cancelled.");
  expect(a.store.configs()[0]).toEqual(original);
  expect(a.registry.status()).toEqual([]);
  expect(await a.registry.listInstalled()).toHaveLength(1);
});

it("keeps the saved agent and its secrets when the runtime is removed", async () => {
  const a = await setup();
  await a.registry.install({ registryId: "example", customAgentId: "example" });
  const original = a.store.configs()[0];
  await a.registry.uninstall("example");
  expect(a.store.configs()[0]).toEqual(original);
  expect(await a.registry.listInstalled()).toEqual([]);
  const records = JSON.parse(await readFile(join(a.folder, "acp-registry", "installed.json"), "utf8"));
  expect(records[0].removed).toBe(true);
  expect((await a.registry.search())[0]?.customAgentId).toBe("example");
});
