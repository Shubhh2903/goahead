import { chmod, copyFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { parseMuseVersion, parsePiVersion } from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import { assertSafeArchive, extractArchive, extractZipTree, rejectNonRegularFiles } from "./provider-runtime-archive";
import type { ProviderRuntimeDescriptor, ProviderStageContext } from "./provider-runtime-descriptors";

/**
 * Pi and Muse downloads share staging and verification, not their wire protocols.
 *
 * Pi publishes an archive with one `pi` folder (a zip with the files at its top level on Windows),
 * which becomes `bin`. Muse publishes one bare executable, which is copied to `bin`. A pinned install
 * is checked file by file against the hashes in `native-runtime.lock.json`.
 */
export function nativeProviderRuntime(runtime: "pi" | "muse"): ProviderRuntimeDescriptor {
  return {
    runtime,
    spec: (target, lock) => {
      const provider = lock[runtime];
      const artifact = provider.artifacts[target];
      return {
        runtime,
        target,
        source: "lock",
        version: provider.version,
        packageVersion: provider.version,
        url: artifact.url,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: async ({ spec, downloadedPath, staging }: ProviderStageContext) => {
      const message = sourceText("error.provider.nativeArchiveInvalid");
      const bin = join(staging, "bin");
      if (runtime === "muse") {
        await mkdir(bin, { recursive: true });
        await copyFile(downloadedPath, join(bin, spec.executableName));
      } else if (spec.target === "win32-x64") {
        await mkdir(bin, { recursive: true });
        await extractZipTree(downloadedPath, bin, "", message);
      } else {
        await assertSafeArchive(downloadedPath, ["pi"], message);
        await extractArchive(downloadedPath, staging);
        await rejectNonRegularFiles(join(staging, "pi"));
        await rename(join(staging, "pi"), bin);
      }
      if (spec.target !== "win32-x64") await chmod(join(bin, spec.executableName), 0o755);
    },
    verify: async (root, spec, lock) => {
      for (const [path, expected] of Object.entries(lock[runtime].artifacts[spec.target].files)) {
        if ((await sha256File(join(root, path))) !== expected) {
          throw new Error(sourceText("error.provider.nativeChecksum"));
        }
      }
    },
    parseVersion: runtime === "pi" ? parsePiVersion : parseMuseVersion,
  };
}
