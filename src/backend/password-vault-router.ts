import type { PasswordVault } from "./password-vault";

const BITWARDEN_PREFIX = "bitwarden:";

/**
 * Joins the 1Password and Bitwarden logins. Prefixes only the new source: existing 1Password item
 * ids keep their meaning. A source that fails stops the list, so a remaining account is never
 * selected in its place.
 */
export function passwordVaultRouter(onePassword: PasswordVault, bitwarden: PasswordVault): PasswordVault {
  return {
    connected: () => onePassword.connected() || bitwarden.connected(),
    loginsFor: async (origin) => {
      const first = await onePassword.loginsFor(origin);
      const second = await bitwarden.loginsFor(origin);
      if (first === null && second === null) return null;
      return [...(first ?? []), ...(second ?? []).map((login) => ({ ...login, id: `${BITWARDEN_PREFIX}${login.id}` }))];
    },
    secretFor: (id, origin, kind) =>
      id.startsWith(BITWARDEN_PREFIX)
        ? bitwarden.secretFor(id.slice(BITWARDEN_PREFIX.length), origin, kind)
        : onePassword.secretFor(id, origin, kind),
  };
}
