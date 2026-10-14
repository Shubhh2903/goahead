import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalMcpSession } from "./local-mcp-bridge";
import type { ClaudeMcpServer } from "./mcp-provider-shapes";

// Pi owns MCP framing, reconnection, cancellation and tool registration. This extension only
// adds the servers for this process. Credentials are not written to the extension file.
const EXTENSION = `export default function (pi) {
  const servers = JSON.parse(process.env.OPENBOT_PI_MCP_SERVERS || "[]");
  delete process.env.OPENBOT_PI_MCP_SERVERS;
  for (const server of servers) pi.registerMcpServer(server.name, server.config);
}
`;

export interface PiMcpExtension {
  path: string;
  environment: Record<string, string>;
  secrets: string[];
  close: () => Promise<void>;
}

/** Owns one temporary, credential-free extension. Pi's own files are never changed. */
export async function createPiMcpExtension(
  servers: Record<string, ClaudeMcpServer>,
  local: LocalMcpSession,
  directory?: string,
): Promise<PiMcpExtension> {
  const root = directory ?? tmpdir();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const folder = await mkdtemp(join(root, "openbot-pi-"));
  const path = join(folder, "mcp.mjs");
  const environment: Record<string, string> = {};
  const secrets: string[] = [];
  const prefix = `openbot_${randomUUID().replaceAll("-", "")}`;
  const values = (pairs: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => {
        if (value === "") return [key, ""];
        const variable = `OPENBOT_PI_MCP_VALUE_${secrets.length}`;
        secrets.push(value);
        environment[variable] = value;
        // Pi expands one environment reference. A literal beginning with ! must never become a
        // configuration shell command, and literal ${...} must not read another environment value.
        return [key, `\${${variable}}`];
      }),
    );
  const entries = Object.values(servers).map((server, index) => ({
    name: `${prefix}_external_${index}`,
    config:
      server.type === "http"
        ? { ...server, headers: values(server.headers), exposure: "direct" }
        : { ...server, env: values(server.env), exposure: "direct" },
  }));
  const bridge = local.servers.map((server, index) => ({
    name: `${prefix}_local_${index}`,
    config: {
      url: server.url,
      headers: values(Object.fromEntries(server.headers.map(({ name, value }) => [name, value]))),
      exposure: "direct",
    },
  }));
  environment.OPENBOT_PI_MCP_SERVERS = JSON.stringify([...entries, ...bridge]);
  try {
    await writeFile(path, EXTENSION, { mode: 0o600 });
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    environment,
    secrets,
    close: () => rm(folder, { recursive: true, force: true }),
  };
}
