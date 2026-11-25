type UpdatePlatform = "ios" | "android";

export interface StoreBuild {
  platform: UpdatePlatform;
  version: string;
  build: string;
  runtimeVersion: string;
  commit: string;
}

export function parseStoreBuilds(lsRemote: string): StoreBuild[] {
  const builds: StoreBuild[] = [];
  for (const line of lsRemote.split("\n")) {
    const match =
      /^([0-9a-f]{40})\trefs\/tags\/mobile-build\/(ios|android)\/([0-9.]+)\/(\d+)\/([A-Za-z0-9._+-]+)$/u.exec(
        line.trim(),
      );
    if (!match) continue;
    const [, commit, platform, version, build, runtimeVersion] = match;
    if (!commit || !version || !build || !runtimeVersion || (platform !== "ios" && platform !== "android")) continue;
    builds.push({ platform, version, build, runtimeVersion, commit });
  }
  return builds.sort((a, b) => Number(b.build) - Number(a.build));
}
