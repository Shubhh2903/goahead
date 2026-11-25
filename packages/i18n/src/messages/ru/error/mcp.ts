import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Этот адрес недоступен по имени.",
  "error.mcp.redirectNotSignIn": "Этот адрес не относится ко входу.",
  "error.mcp.redirectRefused": "Вход отклонён. Вернитесь в GoAhead и повторите попытку.",
  "error.mcp.redirectNoSignIn": "Этот вход больше не активен. Вернитесь в GoAhead и начните вход заново.",
  "error.mcp.redirectSignedIn": "GoAhead выполнил вход. Это окно можно закрыть.",
  "error.mcp.redirectNotSaved": "Вход не завершён. Вернитесь в GoAhead, чтобы узнать причину.",
  "error.mcp.signInFileUnreadable": "Файл входа MCP не читается.",
  "error.mcp.signInFileTooLarge": "Файл входа MCP слишком большой.",
  "error.mcp.unsupported": "Этот сервер не поддерживает серверы MCP.",
  "error.mcp.signInOnHost": "Войти в сервер MCP можно только в GoAhead на компьютере-хосте.",
  "error.mcp.signInPageOnServer":
    "Эта страница входа открывается только на сервере. Попросите владельца или администратора сервера выполнить вход.",
  "error.mcp.signInPageOnServerSwitch":
    "Эта страница входа открывается только на сервере. Переключитесь на этот сервер, затем снова выберите «Войти».",
  "error.mcp.signInAppUnsupported": "Этот сервер не поддерживает приложения входа. Обновите GoAhead на хосте.",
  "error.mcp.redirectRelayed": "GoAhead отправил вход на сервер. Это окно можно закрыть.",
  "error.mcp.relayEnded": "Этот вход завершён. Начните его снова.",
  "error.mcp.signInLinkNotReady": "Страница входа ещё не открыта. Повторите попытку через несколько секунд.",
  "error.mcp.relayNoState":
    "Страница входа сервера не защищает свой обратный адрес, поэтому GoAhead не открывает её на этом компьютере.",
  "error.mcp.relayAddressInvalid":
    "Это не тот адрес, которым завершается этот вход. Скопируйте полный адрес из браузера.",
} as const satisfies PartialTranslation<typeof source>;
