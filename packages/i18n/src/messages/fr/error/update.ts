import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported":
    "Les mises à jour sont disponibles dans les versions installées de l’application de bureau.",
  "error.update.notReady": "Une mise à jour n’est pas prête à être installée.",
  "error.update.restartFailed": "GoAhead n’a pas pu redémarrer pour installer la mise à jour.",
  "error.update.downloadStalled": "Le téléchargement de la mise à jour ne répond plus. Réessayez.",
  "error.update.installFailed": "Impossible d’installer la mise à jour. Quittez puis rouvrez GoAhead, et réessayez.",
  "error.update.notInstalled": "Le dernier redémarrage n’a pas installé la mise à jour. Redémarrez pour réessayer.",
  "error.update.downloadFailed": "Impossible de télécharger la mise à jour. Réessayez.",
  "error.update.signatureNotConfirmed":
    "GoAhead n'a pas pu vérifier la mise à jour. Réessayez. Si l'erreur persiste, téléchargez GoAhead sur goahead.multicodegenius.com/download.",
  "error.update.checkFailed": "Impossible de rechercher des mises à jour. Réessayez.",
  "error.update.checkStalled": "La recherche de mise à jour ne répond plus. Réessayez.",
  "error.update.checkOffline":
    "Impossible de joindre le service de mise à jour. Vérifiez votre connexion Internet, puis réessayez.",
  "error.update.checkUnavailable":
    "Le service de mise à jour n’a pas répondu. GoAhead réessaiera de lui-même dans quelques minutes.",
  "error.update.checkNoRelease":
    "Aucune mise à jour publiée n’a été trouvée pour cette plateforme. GoAhead réessaiera de lui-même dans quelques minutes.",
  "error.update.managedByNix": "Nix installe les mises à jour de cette copie d’GoAhead. Mettez-la à jour avec Nix.",
  "error.update.managedByHost":
    "Sur ce Mac, l’hôte installe les mises à jour. La mise à jour reste prête jusqu’à la maintenance de l’hôte.",
  "error.update.siblingSession":
    "Une autre session GoAhead utilise encore cette application. Quittez d’abord GoAhead dans tous les autres comptes utilisateur macOS, puis installez de nouveau la mise à jour.",
  "error.update.siblingSessionSameAccount":
    "Un autre processus GoAhead est toujours en cours d’exécution dans ce compte utilisateur. Quittez-le, puis installez à nouveau la mise à jour.",
  "error.update.siblingCheckFailed":
    "Impossible de vérifier les autres sessions GoAhead. Réessayez avant l’installation.",
  "error.update.readOnlyLocation":
    "GoAhead ne peut pas installer de mises à jour depuis cet emplacement. Quittez GoAhead. Dans le Finder, faites glisser GoAhead dans le dossier Applications (s’il y est déjà, sortez-le puis remettez-le). Ouvrez ensuite GoAhead et installez de nouveau la mise à jour.",
  "error.update.appImageMissing":
    "GoAhead ne peut pas installer la mise à jour, car son fichier AppImage a été déplacé, renommé ou remplacé. Quittez GoAhead, puis rouvrez le fichier AppImage.",
  "error.update.appImageReadOnly":
    "GoAhead ne peut pas installer de mises à jour dans le dossier de son fichier AppImage. Quittez GoAhead, déplacez le fichier AppImage dans un dossier de votre dossier personnel, puis ouvrez-le et installez à nouveau la mise à jour.",
  "error.update.remoteDisabled": "Les mises à jour des administrateurs du serveur sont désactivées sur cet ordinateur.",
  "error.update.restartStarted": "GoAhead redémarre déjà pour installer la mise à jour.",
  "error.update.alreadyRestarting": "GoAhead redémarre déjà.",
} as const satisfies PartialTranslation<typeof source>;
