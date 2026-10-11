import { describe, expect, it } from "vitest";
import {
  parseReleaseMobileLocalArgs,
  targetInfoPlists,
  timestampBuildNumber,
  withoutSecretLines,
} from "./release-mobile-local-lib";

describe("release-mobile-local helpers", () => {
  // App Store Connect refuses a build number that is not larger than the last upload.
  it("makes a UTC YYMMDDHHmm build number that increases and is larger than build 1", () => {
    const first = timestampBuildNumber(new Date("2026-10-11T15:30:00Z"));
    const later = timestampBuildNumber(new Date("2026-10-11T15:31:00Z"));
    const nextYear = timestampBuildNumber(new Date("2027-01-01T00:00:00Z"));
    expect(first).toBe("2610111530");
    expect(Number(later)).toBeGreaterThan(Number(first));
    expect(Number(nextYear)).toBeGreaterThan(Number(later));
    expect(Number(first)).toBeGreaterThan(1);
  });

  it("reads the flags and refuses an unknown option or a bad build number", () => {
    expect(parseReleaseMobileLocalArgs(["--", "--dry-run"])).toEqual({ dryRun: true, buildNumber: null });
    expect(parseReleaseMobileLocalArgs(["--build-number=42"])).toEqual({ dryRun: false, buildNumber: "42" });
    for (const bad of ["--build-number=1", "--build-number=1.2", "--build-number=", "--build-number=07"]) {
      expect(() => parseReleaseMobileLocalArgs([bad])).toThrow("--build-number must be digits only");
    }
    expect(() => parseReleaseMobileLocalArgs(["--upload"])).toThrow("Unknown option --upload");
  });

  it("finds the app and widget Info.plist files and skips Pods, build and Xcode bundles", () => {
    const entries = ["Pods", "build", "GoAhead.xcodeproj", "GoAhead.xcworkspace", "GoAhead", "ExpoWidgetsTarget"];
    expect(targetInfoPlists(entries, () => true)).toEqual(["ExpoWidgetsTarget/Info.plist", "GoAhead/Info.plist"]);
    expect(targetInfoPlists(entries, (entry) => entry === "GoAhead")).toEqual(["GoAhead/Info.plist"]);
  });

  it("removes each output line that holds the password", () => {
    expect(withoutSecretLines("ok\nfailed for pw-123 here\nend", "pw-123")).toBe("ok\nend");
  });
});
