import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack n’accepte plus GoAhead dans cet espace de travail. Il a peut-être été désinstallé. Connectez à nouveau l’espace de travail.",
  "messaging.help.secret_storage_unavailable":
    "GoAhead ne peut pas lire les jetons enregistrés sur cet ordinateur. Déconnectez l’espace de travail, puis connectez-le à nouveau.",
  "messaging.help.relay_unavailable":
    "GoAhead ne peut pas recevoir les événements Slack sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur dans les réglages du serveur et gardez GoAhead ouvert.",
  "messaging.help.not_linked":
    "Cet espace de travail n’est pas lié à ce serveur. Sélectionnez Reconnecter pour le lier.",
  "messaging.discordHelp.invalid_token":
    "Discord n’accepte plus GoAhead sur ce serveur Discord. Il a peut-être été retiré. Connectez à nouveau le serveur Discord.",
  "messaging.discordHelp.secret_storage_unavailable":
    "GoAhead ne peut pas lire les jetons enregistrés sur cet ordinateur. Déconnectez le serveur Discord, puis connectez-le à nouveau.",
  "messaging.discordHelp.relay_unavailable":
    "GoAhead ne peut pas recevoir les événements Discord sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur dans les réglages du serveur et gardez GoAhead ouvert.",
  "messaging.discordHelp.not_linked":
    "Ce serveur Discord n’est pas lié à ce serveur GoAhead. Sélectionnez Reconnecter pour le lier.",
} as const satisfies PartialTranslation<typeof source>;
