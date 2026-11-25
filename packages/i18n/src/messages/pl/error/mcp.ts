import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Ten adres nie jest osiągalny po nazwie.",
  "error.mcp.redirectNotSignIn": "Ten adres nie jest częścią logowania.",
  "error.mcp.redirectRefused": "Logowanie zostało odrzucone. Wróć do GoAhead i spróbuj ponownie.",
  "error.mcp.redirectNoSignIn": "To logowanie nie jest już aktywne. Wróć do GoAhead i rozpocznij logowanie ponownie.",
  "error.mcp.redirectSignedIn": "GoAhead jest zalogowany. Możesz zamknąć to okno.",
  "error.mcp.redirectNotSaved": "Logowanie nie zostało zakończone. Wróć do GoAhead, aby zobaczyć powód.",
  "error.mcp.signInFileUnreadable": "Nie można odczytać pliku logowania MCP.",
  "error.mcp.signInFileTooLarge": "Plik logowania MCP jest za duży.",
  "error.mcp.unsupported": "Ten serwer nie obsługuje serwerów MCP.",
  "error.mcp.signInOnHost": "Logowanie do serwera MCP działa tylko w GoAhead na komputerze hosta.",
  "error.mcp.signInPageOnServer":
    "Ta strona logowania otwiera się tylko na serwerze. Poproś właściciela lub administratora serwera o zalogowanie się.",
  "error.mcp.signInPageOnServerSwitch":
    "Ta strona logowania otwiera się tylko na serwerze. Przełącz się na ten serwer, a potem ponownie wybierz Zaloguj się.",
  "error.mcp.signInAppUnsupported": "Ten serwer nie obsługuje aplikacji logowania. Zaktualizuj GoAhead na hoście.",
  "error.mcp.redirectRelayed": "GoAhead wysłał logowanie do serwera. Możesz zamknąć to okno.",
  "error.mcp.relayEnded": "To logowanie się zakończyło. Rozpocznij je ponownie.",
  "error.mcp.signInLinkNotReady": "Strona logowania nie jest jeszcze otwarta. Spróbuj ponownie za chwilę.",
  "error.mcp.relayNoState":
    "Strona logowania serwera nie chroni swojego adresu powrotu, więc GoAhead nie otworzy jej na tym komputerze.",
  "error.mcp.relayAddressInvalid": "To nie jest adres z końca tego logowania. Skopiuj pełny adres z przeglądarki.",
} as const satisfies PartialTranslation<typeof source>;
