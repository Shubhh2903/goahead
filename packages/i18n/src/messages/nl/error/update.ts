import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Updates zijn beschikbaar in geïnstalleerde desktopbuilds.",
  "error.update.notReady": "Er is geen update klaar om te installeren.",
  "error.update.restartFailed": "GoAhead kon niet herstarten om de update te installeren.",
  "error.update.downloadStalled": "De download van de update reageert niet meer. Probeer het opnieuw.",
  "error.update.installFailed":
    "Kan de update niet installeren. Stop GoAhead, open het opnieuw en probeer het nog eens.",
  "error.update.notInstalled":
    "Bij de laatste herstart is de update niet geïnstalleerd. Start opnieuw om het nog eens te proberen.",
  "error.update.downloadFailed": "Kan de update niet downloaden. Probeer het opnieuw.",
  "error.update.signatureNotConfirmed":
    "GoAhead kan de update niet verifiëren. Probeer het opnieuw. Blijft deze fout terugkomen, download GoAhead dan via goahead.multicodegenius.com/download.",
  "error.update.checkFailed": "Kan niet controleren op updates. Probeer het opnieuw.",
  "error.update.checkStalled": "De controle op updates reageert niet meer. Probeer het opnieuw.",
  "error.update.checkOffline":
    "Kan de updateservice niet bereiken. Controleer je internetverbinding en probeer het opnieuw.",
  "error.update.checkUnavailable":
    "De updateservice reageerde niet. GoAhead probeert het over een paar minuten zelf opnieuw.",
  "error.update.checkNoRelease":
    "Er is geen gepubliceerde update gevonden voor dit platform. GoAhead probeert het over een paar minuten zelf opnieuw.",
  "error.update.managedByNix": "Nix installeert updates voor deze kopie va GoAhead. Werk hem bij met Nix.",
  "error.update.managedByHost":
    "Updates op deze Mac worden door de host geïnstalleerd. De update blijft klaarstaan tot het onderhoud van de host draait.",
  "error.update.siblingSession":
    "Er draait nog een andere OpenBot-sessie vanuit deze app. Stop GoAhead eerst in alle andere macOS-gebruikersaccounts en installeer de update dan opnieuw.",
  "error.update.siblingSessionSameAccount":
    "Er draait nog een ander OpenBot-proces in dit gebruikersaccount. Stop het en installeer de update dan opnieuw.",
  "error.update.siblingCheckFailed":
    "Kan andere OpenBot-sessies niet controleren. Probeer het opnieuw voordat je installeert.",
  "error.update.readOnlyLocation":
    "GoAhead kan vanaf deze locatie geen updates installeren. Sluit GoAhead af. Sleep GoAhead in de Finder naar de map Apps (staat het er al, sleep het er dan uit en weer in). Open GoAhead daarna en installeer de update opnieuw.",
  "error.update.appImageMissing":
    "GoAhead kan de update niet installeren, omdat het AppImage-bestand is verplaatst, hernoemd of vervangen. Sluit GoAhead af en open het AppImage-bestand opnieuw.",
  "error.update.appImageReadOnly":
    "GoAhead kan geen updates installeren in de map van het AppImage-bestand. Sluit GoAhead af, verplaats het AppImage-bestand naar een map in je thuismap, open het en installeer de update opnieuw.",
  "error.update.remoteDisabled": "Updates door serverbeheerders staan uit op deze computer.",
  "error.update.restartStarted": "GoAhead herstart al om de update te installeren.",
  "error.update.alreadyRestarting": "GoAhead herstart al.",
} as const satisfies PartialTranslation<typeof source>;
