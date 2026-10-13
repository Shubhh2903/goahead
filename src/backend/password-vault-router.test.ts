import { describe, expect, it, vi } from "vitest";
import type { PasswordVault } from "./password-vault";
import { passwordVaultRouter } from "./password-vault-router";

function vault(value: string): PasswordVault {
  return {
    connected: () => true,
    loginsFor: async () => [{ id: "same-id", title: value, username: null, hasOneTimePassword: false }],
    secretFor: vi.fn(async () => value),
  };
}

describe("password vault routing", () => {
  it("keeps existing ids and routes a colliding Bitwarden id to its source only", async () => {
    const first = vault("first");
    const second = vault("second");
    const router = passwordVaultRouter(first, second);
    expect((await router.loginsFor("https://example.com"))?.map((item) => item.id)).toEqual([
      "same-id",
      "bitwarden:same-id",
    ]);
    expect(await router.secretFor("same-id", "https://example.com", "password")).toBe("first");
    expect(await router.secretFor("bitwarden:same-id", "https://example.com", "totp")).toBe("second");
    expect(second.secretFor).toHaveBeenCalledWith("same-id", "https://example.com", "totp");
    expect(first.secretFor).toHaveBeenCalledOnce();
  });

  it("does not silently select a remaining account when a source fails", async () => {
    const first = vault("first");
    first.loginsFor = () => Promise.reject(new Error("Unavailable"));
    await expect(passwordVaultRouter(first, vault("second")).loginsFor("https://example.com")).rejects.toThrow(
      "Unavailable",
    );
  });
});
