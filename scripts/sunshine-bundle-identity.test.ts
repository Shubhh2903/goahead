import { describe, expect, it } from "vitest";
import {
  chooseSunshineSigner,
  DEVELOPMENT_SUNSHINE_BUNDLE_ID,
  isSunshineIdentityCurrent,
  PINNED_SUNSHINE_BUNDLE_ID,
  parseAppleDevelopmentIdentity,
  plistBuddySetBundleIdArgs,
  type SunshineIdentityRecord,
  sunshineCodesignArgs,
  sunshineDigestOverrides,
  sunshineVariantFromEnvironment,
} from "./sunshine-bundle-identity";

const DEVELOPMENT_HASH = "A".repeat(40);
const FIND_IDENTITY_OUTPUT = `  1) ${"B".repeat(40)} "Developer ID Application: Example Ltd (S29HD2MDR4)"
  2) ${DEVELOPMENT_HASH} "Apple Development: Dev Person (ABCDE12345)"
  3) ${"C".repeat(40)} "Apple Development: Other Person (FGHIJ67890)"
     3 valid identities found
`;

describe("Sunshine bundle identity", () => {
  it("keeps the pinned release bundle id and gives the development copy its own", () => {
    expect(PINNED_SUNSHINE_BUNDLE_ID).toBe("dev.lizardbyte.app.Sunshine");
    expect(DEVELOPMENT_SUNSHINE_BUNDLE_ID).toBe("com.multicodegenius.goahead.sunshine.dev");
    expect(sunshineVariantFromEnvironment({})).toBe("development");
    expect(sunshineVariantFromEnvironment({ OPENBOT_REMOTE_DESKTOP_VARIANT: "release" })).toBe("release");
    expect(() => sunshineVariantFromEnvironment({ OPENBOT_REMOTE_DESKTOP_VARIANT: "prod" })).toThrow();
  });

  it("selects the first Apple Development identity and falls back to ad hoc", () => {
    expect(parseAppleDevelopmentIdentity(FIND_IDENTITY_OUTPUT)).toEqual({
      kind: "identity",
      hash: DEVELOPMENT_HASH,
      name: "Apple Development: Dev Person (ABCDE12345)",
    });
    expect(parseAppleDevelopmentIdentity("     0 valid identities found\n")).toBeNull();
    expect(chooseSunshineSigner(() => FIND_IDENTITY_OUTPUT, {})).toMatchObject({
      hash: DEVELOPMENT_HASH,
    });
    const notCalled = () => {
      throw new Error("The keychain must not be read.");
    };
    expect(chooseSunshineSigner(notCalled, { CI: "true" })).toEqual({ kind: "adhoc" });
    expect(chooseSunshineSigner(notCalled, {})).toEqual({ kind: "adhoc" });
  });

  it("builds the plist edit and signing commands", () => {
    expect(plistBuddySetBundleIdArgs("/r/Sunshine.app/Contents/Info.plist", DEVELOPMENT_SUNSHINE_BUNDLE_ID)).toEqual([
      "-c",
      "Set :CFBundleIdentifier com.multicodegenius.goahead.sunshine.dev",
      "/r/Sunshine.app/Contents/Info.plist",
    ]);
    expect(() => plistBuddySetBundleIdArgs("/r/Info.plist", "id; Delete :CFBundleExecutable")).toThrow();
    expect(sunshineCodesignArgs("/r/Sunshine.app", { kind: "adhoc" }, "/e.plist")).toEqual([
      "--force",
      "--deep",
      "--sign",
      "-",
      "/r/Sunshine.app",
    ]);
    expect(
      sunshineCodesignArgs("/r/Sunshine.app", { kind: "identity", hash: DEVELOPMENT_HASH, name: "n" }, "/e.plist"),
    ).toEqual([
      "--force",
      "--deep",
      "--options",
      "runtime",
      "--entitlements",
      "/e.plist",
      "--sign",
      DEVELOPMENT_HASH,
      "/r/Sunshine.app",
    ]);
  });

  it("overrides only Sunshine.app digests and detects a changed plan", () => {
    const record: SunshineIdentityRecord = {
      schemaVersion: 1,
      variant: "development",
      bundleId: DEVELOPMENT_SUNSHINE_BUNDLE_ID,
      signer: DEVELOPMENT_HASH,
      files: { "Sunshine.app/Contents/Info.plist": "1".repeat(64), "web-server": "2".repeat(64) },
    };
    expect([...sunshineDigestOverrides(record, "darwin/arm64/")]).toEqual([
      ["darwin/arm64/Sunshine.app/Contents/Info.plist", "1".repeat(64)],
    ]);
    const plan = {
      bundleId: DEVELOPMENT_SUNSHINE_BUNDLE_ID,
      signer: { kind: "identity" as const, hash: DEVELOPMENT_HASH, name: "n" },
    };
    expect(isSunshineIdentityCurrent(record, plan)).toBe(true);
    expect(isSunshineIdentityCurrent(record, { ...plan, signer: { kind: "adhoc" } })).toBe(false);
    expect(isSunshineIdentityCurrent(record, { ...plan, bundleId: PINNED_SUNSHINE_BUNDLE_ID })).toBe(false);
    expect(isSunshineIdentityCurrent(null, plan)).toBe(false);
  });
});
