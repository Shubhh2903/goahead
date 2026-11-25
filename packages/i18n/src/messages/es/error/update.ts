import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Las actualizaciones están disponibles en las versiones de escritorio instaladas.",
  "error.update.notReady": "No hay ninguna actualización lista para instalar.",
  "error.update.restartFailed": "GoAhead no pudo reiniciarse para instalar la actualización.",
  "error.update.downloadStalled": "La descarga de la actualización dejó de responder. Inténtalo de nuevo.",
  "error.update.installFailed":
    "No se pudo instalar la actualización. Cierra y vuelve a abrir GoAhead e inténtalo de nuevo.",
  "error.update.notInstalled": "El último reinicio no instaló la actualización. Reinicia para intentarlo de nuevo.",
  "error.update.downloadFailed": "No se pudo descargar la actualización. Inténtalo de nuevo.",
  "error.update.signatureNotConfirmed":
    "GoAhead no pudo verificar la actualización. Inténtalo de nuevo. Si el error continúa, descarga GoAhead desde goahead.multicodegenius.com/download.",
  "error.update.checkFailed": "No se pudieron buscar actualizaciones. Inténtalo de nuevo.",
  "error.update.checkStalled": "La búsqueda de actualizaciones dejó de responder. Inténtalo de nuevo.",
  "error.update.checkOffline":
    "No se pudo acceder al servicio de actualizaciones. Comprueba tu conexión a Internet e inténtalo de nuevo.",
  "error.update.checkUnavailable":
    "El servicio de actualizaciones no respondió. GoAhead lo volverá a intentar automáticamente en unos minutos.",
  "error.update.checkNoRelease":
    "No se encontró ninguna actualización publicada para esta plataforma. GoAhead lo volverá a intentar automáticamente en unos minutos.",
  "error.update.managedByNix": "Nix instala las actualizaciones de esta copia de GoAhead. Actualízala con Nix.",
  "error.update.managedByHost":
    "El host instala las actualizaciones en este Mac. La actualización permanecerá lista hasta que se ejecute el mantenimiento del host.",
  "error.update.siblingSession":
    "Otra sesión de GoAhead sigue ejecutándose desde esta aplicación. Primero detén GoAhead en todas las demás cuentas de usuario de macOS y vuelve a instalar la actualización.",
  "error.update.siblingSessionSameAccount":
    "Otro proceso de GoAhead sigue ejecutándose en esta cuenta de usuario. Ciérralo y vuelve a instalar la actualización.",
  "error.update.siblingCheckFailed":
    "No se pudieron verificar otras sesiones de GoAhead. Inténtalo de nuevo antes de instalar.",
  "error.update.readOnlyLocation":
    "GoAhead no puede instalar actualizaciones desde esta ubicación. Cierra GoAhead. En Finder, arrastra GoAhead a la carpeta Aplicaciones (si ya está allí, sácalo y vuelve a ponerlo). Después abre GoAhead e instala la actualización de nuevo.",
  "error.update.appImageMissing":
    "GoAhead no puede instalar la actualización porque su archivo AppImage se movió, se renombró o se reemplazó. Cierra GoAhead y vuelve a abrir el archivo AppImage.",
  "error.update.appImageReadOnly":
    "GoAhead no puede instalar actualizaciones en la carpeta de su archivo AppImage. Cierra GoAhead, mueve el archivo AppImage a una carpeta de tu carpeta personal, ábrelo e instala la actualización de nuevo.",
  "error.update.remoteDisabled":
    "Las actualizaciones por parte de administradores del servidor están desactivadas en este equipo.",
  "error.update.restartStarted": "GoAhead ya se está reiniciando para instalar la actualización.",
  "error.update.alreadyRestarting": "GoAhead ya se está reiniciando.",
} as const satisfies PartialTranslation<typeof source>;
