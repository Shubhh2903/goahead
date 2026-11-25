import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "GoAhead n’a pas pu joindre le service de compte. Vérifiez que l’API fonctionne, puis réessayez.",
  "error.auth.sessionTimeout": "GoAhead n’a pas répondu à temps. Vérifiez votre connexion internet, puis réessayez.",
  "error.auth.networkBlocked":
    "Un pare-feu ou un proxy de ce réseau a empêché GoAhead de joindre {host}. Demandez à votre administrateur réseau d’autoriser {host}, puis réessayez.",
  "error.auth.signInFirst": "Connectez-vous d’abord à GoAhead.",
  "error.auth.signInRequired": "Une connexion est requise.",
  "error.auth.chatColorUnavailable":
    "Le service de compte ne prend pas encore en charge les couleurs de discussion. Réessayez plus tard.",
  "error.auth.accountChangedDuringRegister": "Le compte connecté a changé pendant l’enregistrement de ce serveur.",
  "error.auth.hostCredentialUnavailable":
    "L’identifiant de l’hôte distant n’est pas disponible. Enregistrez à nouveau l’hôte.",
  "error.auth.codeNotVerified": "Impossible de vérifier le code de connexion.",
  "error.auth.serviceError": "Le service de compte a renvoyé une erreur.",
  "error.auth.serviceUnreachable":
    "GoAhead n’a pas pu joindre le service de compte. Vérifiez votre connexion, puis réessayez.",
  "error.auth.serviceTimeout": "Le service de compte n’a pas répondu à temps. Réessayez.",
  "error.auth.serviceStatus": "Le service de compte a renvoyé une erreur ({status}). Réessayez plus tard.",
  "error.auth.invalidHostedServer": "Le service de compte a renvoyé un serveur hébergé invalide.",
  "error.auth.invalidServerClaim": "Le service de compte a renvoyé un code de serveur invalide.",
  "error.auth.codeNotSent": "GoAhead n’a pas pu envoyer le code de connexion.",
  "error.auth.deliveryTimeout":
    "GoAhead n’a pas pu confirmer l’envoi à temps. Le code peut encore arriver ; vérifiez sa réception avant de le renvoyer.",
  "error.auth.deliveryInterrupted":
    "La connexion s’est terminée avant que GoAhead confirme l’envoi. Vérifiez la réception pour ne pas envoyer un autre code.",
  "error.auth.deliveryUnknown":
    "GoAhead n’a pas pu confirmer si le code de connexion a été envoyé. Vérifiez sa réception avant de le renvoyer.",
} as const satisfies PartialTranslation<typeof source>;
