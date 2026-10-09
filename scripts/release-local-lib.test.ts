import { describe, expect, it } from "vitest";
import {
  findDeveloperIdIdentities,
  formatCommand,
  parseEnvFile,
  parseReleaseLocalArgs,
  resolvePlaceholders,
} from "./release-local-lib";

describe("release-local helpers", () => {
  it("reads the flags and refuses an unknown one", () => {
    expect(parseReleaseLocalArgs(["--", "--dry-run", "--replace"])).toEqual({
      dryRun: true,
      skipBuild: false,
      replace: true,
    });
    expect(() => parseReleaseLocalArgs(["--publish"])).toThrow("Unknown option --publish");
  });

  it("finds only the company Developer ID identities", () => {
    const output = [
      '  1) AAAA "Apple Development: Someone (ZZZZZZZZZZ)"',
      '  2) BBBB "Developer ID Application: Other Co (ABCDE12345)"',
      '  3) CCCC "Developer ID Application: Multicode Genius (S29HD2MDR4)"',
      '  4) DDDD "Developer ID Installer: Multicode Genius (S29HD2MDR4)"',
      "     4 valid identities found",
    ].join("\n");
    expect(findDeveloperIdIdentities(output, "S29HD2MDR4")).toEqual({
      application: "Multicode Genius (S29HD2MDR4)",
      installer: "Multicode Genius (S29HD2MDR4)",
    });
    expect(findDeveloperIdIdentities(output, "QQQQQQQQQQ")).toEqual({ application: null, installer: null });
  });

  it("reads quoted, exported and commented dotenv lines", () => {
    const values = parseEnvFile(
      [
        "# comment",
        "export APPLE_ID=a@b.c",
        "APPLE_APP_SPECIFIC_PASSWORD='ab#cd'",
        "APPLE_TEAM_ID=S29HD2MDR4 # team",
        "",
      ].join("\n"),
    );
    expect(Object.fromEntries(values)).toEqual({
      APPLE_ID: "a@b.c",
      APPLE_APP_SPECIFIC_PASSWORD: "ab#cd",
      APPLE_TEAM_ID: "S29HD2MDR4",
    });
  });

  // A planned or failed command is printed with its placeholders, so a secret never reaches the log.
  it("keeps secrets out of the printed command and puts them in the executed one", () => {
    const argv = ["xcrun", "notarytool", "submit", "a.dmg", "--password", "$APPLE_APP_SPECIFIC_PASSWORD"];
    expect(formatCommand(argv)).not.toContain("hunter2-secret");
    expect(resolvePlaceholders(argv, { APPLE_APP_SPECIFIC_PASSWORD: "hunter2-secret" }).at(-1)).toBe("hunter2-secret");
    expect(() => resolvePlaceholders(argv, {})).toThrow("APPLE_APP_SPECIFIC_PASSWORD is not set.");
  });
});
