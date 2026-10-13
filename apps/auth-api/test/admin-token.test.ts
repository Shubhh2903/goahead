import { describe, expect, it } from "vitest";
import { adminTokenMatches } from "../src/server/admin-token";

describe("admin token", () => {
  it("accepts only the configured token", async () => {
    expect(await adminTokenMatches("admin-secret", "admin-secret")).toBe(true);
    expect(await adminTokenMatches("admin-secret", "admin-secreT")).toBe(false);
    expect(await adminTokenMatches("admin-secret", "admin")).toBe(false);
    expect(await adminTokenMatches("admin-secret", null)).toBe(false);
  });

  it("refuses every token when none is configured", async () => {
    expect(await adminTokenMatches(undefined, "admin-secret")).toBe(false);
    expect(await adminTokenMatches("", "")).toBe(false);
  });
});
