import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Нужен ваш ответ.",
  "notification.needsApproval": "Нужно ваше подтверждение.",
  "notification.needsBrowserStep": "Нужно, чтобы вы завершили шаг в браузере.",
  "notification.waitsForSignIn": "Ждёт входа в {provider}.",
  "notification.needsApprovalFor": "Нужно ваше подтверждение: {action}",
  "notification.finished": "Работа завершена.",
  "notification.workflowApproval": "Шаг ждет вашего одобрения.",
  "notification.workflowOutput": "У рабочего процесса есть новый результат.",
  "notification.failed": "Остановлено из-за ошибки.",
  "notification.subagentFailed": "Субагент остановлен из-за ошибки.",
  "notification.subagentFailedFor": "Субагент остановлен из-за ошибки: {task}",
  "notification.channelTitle": "{agent} в канале {channel}",
  "notification.channelMessage": "Новое сообщение.",
  "notification.usageLimit.title": "Аккаунт {provider} достиг лимита",
  "notification.usageLimit.body": {
    one: "Ждёт {count} агент. GoAhead попробует позже.",
    few: "Ждут {count} агента. GoAhead попробует позже.",
    many: "Ждут {count} агентов. GoAhead попробует позже.",
    other: "Ждут {count} агента. GoAhead попробует позже.",
  },
  "notification.usageLimit.bodyResets": {
    one: "Ждёт {count} агент. Сброс {reset}.",
    few: "Ждут {count} агента. Сброс {reset}.",
    many: "Ждут {count} агентов. Сброс {reset}.",
    other: "Ждут {count} агента. Сброс {reset}.",
  },
  "notification.machineAlert.disk": "{server}: диск заполнен на {percent}",
  "notification.machineAlert.memory": "{server}: память занята на {percent}",
  "notification.machineAlert.cpu": "{server}: CPU загружен на {percent}",
  "notification.machineAlert.body": "Превышен порог оповещения {level}. См. «Настройки сервера» → «Хранилище».",
  "notification.test": "Уведомления работают.",
  "notification.welcome": "GoAhead сообщит здесь, когда вы понадобитесь агенту.",
  "notification.toast.region": "Уведомления",
  "notification.toast.close": "Закрыть уведомление",
} as const satisfies PartialTranslation<typeof source>;
