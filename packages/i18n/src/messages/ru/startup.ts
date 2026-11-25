import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "GoAhead не удалось запустить",
  "startup.failedBody":
    "{message}\n\nЛокальные данные не сброшены и не перезаписаны. Шаги восстановления — в руководстве по устранению неполадок.",
  "startup.archiveChangedTitle": "Файлы GoAhead изменены",
  "startup.archiveChangedBody":
    "Другая программа изменила файл GoAhead app.asar. Сейчас GoAhead работает, но после выхода он больше не запустится.\n\nЧтобы исправить это, установите GoAhead заново. Ваши локальные данные сохранятся.",
  "startup.archiveChangedDownload": "Скачать GoAhead",
  "startup.filesDamagedBody":
    "Некоторые файлы GoAhead повреждены или отсутствуют.\n\nЧтобы исправить это, установите GoAhead заново. Ваши локальные данные сохранятся.",
  "startup.newerDataUpdatingTitle": "Обновление GoAhead",
  "startup.newerDataUpdatingBody":
    "Более новая версия GoAhead сохранила ваши данные. GoAhead устанавливает последнюю версию и затем откроется снова.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataTitle": "Установите последнюю версию GoAhead",
  "startup.newerDataBody":
    "Более новая версия GoAhead сохранила ваши данные, и эта версия ({version}) не может их открыть. Установите последнюю версию, чтобы открыть данные.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataDownload": "Скачать GoAhead",
  "startup.newerDataGuide": "Открыть руководство",
  "startup.newerDataQuit": "Выйти",
  "startup.newerDataLoopTitle": "Последняя версия GoAhead не открылась",
  "startup.newerDataLoopBody":
    "Более новая версия GoAhead сохранила ваши данные, и эта версия ({version}) не может их открыть. GoAhead {loopVersion} несколько раз подряд останавливался до открытия, поэтому он не будет установлен снова.\n\nУстановите версию новее {loopVersion}, когда она появится. Чтобы получить помощь, откройте руководство.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataReleases": "Показать версии",
  "startup.recoveryWindowTitle": "Восстановление GoAhead",
  "startup.recoveryTitle": "GoAhead не открылся",
  "startup.recoveryBody": {
    one: "GoAhead {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    few: "GoAhead {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    many: "GoAhead {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    other:
      "GoAhead {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
  },
  "startup.recoveryHint":
    "Попробуйте снова или установите последнюю версию, которая открывалась. Чтобы получить помощь, экспортируйте диагностику и отправьте файл вместе с отчётом.",
  "startup.recoveryHintLatest":
    "GoAhead не нашёл более раннюю версию, которая может открыть ваши данные. Попробуйте снова или установите последнюю версию. Чтобы получить помощь, экспортируйте диагностику и отправьте файл вместе с отчётом.",
  "startup.recoveryRetry": "Повторить",
  "startup.recoveryPreviousVersion": "Скачать прошлую версию",
  "startup.recoveryLatestVersion": "Скачать последнюю версию",
  "startup.recoveryExportDiagnostics": "Экспорт диагностики",
  "startup.recoveryOpenDataFolder": "Открыть папку данных",
  "startup.recoveryQuit": "Выйти",
  "startup.recoveryDiagnosticsSaved": "Файл диагностики сохранён.",
  "startup.recoveryActionFailed": "GoAhead не удалось выполнить это действие.",
} as const satisfies PartialTranslation<typeof source>;
