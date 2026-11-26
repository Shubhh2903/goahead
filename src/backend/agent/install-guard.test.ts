import { describe, expect, it } from "vitest";
import { guardedInstall, InstallAllowances, providerCommandText } from "./install-guard";

describe("guardedInstall", () => {
  it.each([
    ['xcrun simctl create "iPhone 17" com.apple.CoreSimulator.SimDeviceType.iPhone-17', "simulator-create"],
    ["xcrun simctl runtime add x.dmg", "simulator-runtime"],
    ["xcodebuild -downloadPlatform iOS", "xcode-platform"],
    ["xcodebuild -downloadAllPlatforms", "xcode-platform"],
    ['sdkmanager "system-images;android-35;google_apis;arm64-v8a"', "android-sdk"],
    ["sdkmanager --install platform-tools", "android-sdk"],
    ["avdmanager create avd -n x -k 'system-images;android-35;google_apis;arm64-v8a'", "android-avd"],
    ["pod install", "cocoapods"],
    ["cd ios && pod install --repo-update", "cocoapods"],
    ["pod repo update", "cocoapods"],
    // The forms that agents use: a wrapper, a full path, a shell that Codex starts.
    ["sudo env LANG=en_US.UTF-8 /usr/bin/xcrun simctl create Test iPhone-17", "simulator-create"],
    ["/bin/zsh -lc 'cd ios && bundle exec pod install'", "cocoapods"],
    ["$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --update", "android-sdk"],
  ])("guards %s", (command, rule) => {
    expect(guardedInstall(command)).toBe(rule);
  });

  it.each([
    "xcrun simctl list",
    "xcrun simctl boot X",
    "pod --version",
    "sdkmanager --list",
    'echo "run pod install later"',
    'grep -r "pod install" docs',
    "xcrun simctl list | grep create",
    "sdkmanager --uninstall platform-tools",
    "xcodebuild -showsdks",
    "",
  ])("does not guard %s", (command) => {
    expect(guardedInstall(command)).toBeNull();
  });
});

describe("providerCommandText", () => {
  it("reads a Codex command, an ACP raw input, and an argument list", () => {
    expect(providerCommandText({ type: "commandExecution", command: "pod install" })).toBe("pod install");
    expect(providerCommandText({ type: "toolCall", toolKind: "execute", arguments: { command: "pod install" } })).toBe(
      "pod install",
    );
    expect(
      guardedInstall(providerCommandText({ type: "commandExecution", command: ["bash", "-lc", "pod install"] }) ?? ""),
    ).toBe("cocoapods");
    expect(
      providerCommandText({ type: "toolCall", toolKind: "read", arguments: { command: "pod install" } }),
    ).toBeNull();
    expect(providerCommandText({ type: "toolCall", name: "Bash", arguments: { command: "pod install" } })).toBeNull();
  });
});

describe("InstallAllowances", () => {
  it("allows a rule for one agent for 60 minutes", () => {
    const allowances = new InstallAllowances();
    const now = 1_000_000;
    allowances.allow("chief", "cocoapods", now);
    expect(allowances.isAllowed("chief", "cocoapods", now + 59 * 60_000)).toBe(true);
    expect(allowances.isAllowed("chief", "cocoapods", now + 61 * 60_000)).toBe(false);
    expect(allowances.isAllowed("worker", "cocoapods", now)).toBe(false);
    expect(allowances.isAllowed("chief", "android-sdk", now)).toBe(false);
  });
});
