import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { parseEnvFile } from "./scripts/release-local-lib";

const rendererPort = readRendererPort(process.env.OPENBOT_DEV_RENDERER_PORT);

export default defineConfig({
  main: {
    // The Google OAuth client of this build. See `googleClientDefine` below.
    define: googleClientDefine(),
    // Workspace sources ship as TypeScript and must be bundled for the packaged app.
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@openbot/brand", "@openbot/contracts", "@openbot/i18n", "@openbot/logging", "@openbot/team-client"],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          // The database host is its own process. Its runtime imports are `node:*` only, so it
          // emits a standalone chunk that `utilityProcess.fork` can load by path.
          "agent-database-host": resolve("src/backend/agent-data/agent-database-host.ts"),
          // The voice host is its own process too. It imports only node:* and loads the speech
          // recognition addon by path.
          "voice-transcription-host": resolve("src/main/voice-transcription-host.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@openbot/contracts"] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          teamWebrtc: resolve("src/preload/team-webrtc.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [solidPlugin(), tailwindcss({ optimize: false })],
    optimizeDeps: {
      include: ["@norbert_bodziony/bloub"],
    },
    resolve: {
      dedupe: ["solid-js", "@solidjs/web"],
    },
    server: rendererPort ? { port: rendererPort, strictPort: true } : undefined,
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          helper: resolve("src/renderer/helper.html"),
          browserPip: resolve("src/renderer/browser-pip.html"),
          browserPipControls: resolve("src/renderer/browser-pip-controls.html"),
          teamWebrtc: resolve("src/renderer/team-webrtc.html"),
        },
      },
    },
  },
});

function readRendererPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_DEV_RENDERER_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}

/**
 * Writes the Google OAuth "Desktop app" client into the main bundle (`google-connector-config.ts`).
 * A value in the shell wins over `.env.google`, which git ignores. With no value, the build offers no
 * Google connection. The names are in `.env.google.example`.
 */
function googleClientDefine(): Record<string, string> {
  const file = existsSync(".env.google")
    ? parseEnvFile(readFileSync(".env.google", "utf8"))
    : new Map<string, string>();
  const value = (name: string) => process.env[name]?.trim() || file.get(name)?.trim() || "";
  return {
    "process.env.OPENBOT_GOOGLE_CLIENT_ID": JSON.stringify(value("OPENBOT_GOOGLE_CLIENT_ID")),
    "process.env.OPENBOT_GOOGLE_CLIENT_SECRET": JSON.stringify(value("OPENBOT_GOOGLE_CLIENT_SECRET")),
  };
}
