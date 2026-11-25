import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "لم يعد Slack يقبل GoAhead في مساحة العمل هذه. ربما أُلغي تثبيته. اربط مساحة العمل مرة أخرى.",
  "messaging.help.secret_storage_unavailable":
    "يتعذّر على GoAhead قراءة الرموز المحفوظة على هذا الحاسوب. افصل مساحة العمل، ثم اربطها مرة أخرى.",
  "messaging.help.relay_unavailable":
    "يتعذّر على GoAhead تلقي أحداث Slack على هذا الحاسوب. سجّل الدخول، وامنح هذا الحاسوب اسمًا في إعدادات الخادم، وأبقِ GoAhead مفتوحًا.",
  "messaging.help.not_linked": 'مساحة العمل هذه غير مرتبطة بهذا الخادم. اختر "إعادة الربط" لربطها.',
  "messaging.discordHelp.invalid_token":
    "لم يعد Discord يقبل GoAhead في خادم Discord هذا. ربما أُزيل. اربط خادم Discord مرة أخرى.",
  "messaging.discordHelp.secret_storage_unavailable":
    "يتعذّر على GoAhead قراءة الرموز المحفوظة على هذا الحاسوب. افصل خادم Discord، ثم اربطه مرة أخرى.",
  "messaging.discordHelp.relay_unavailable":
    "يتعذّر على GoAhead تلقي أحداث Discord على هذا الحاسوب. سجّل الدخول، وامنح هذا الحاسوب اسمًا في إعدادات الخادم، وأبقِ GoAhead مفتوحًا.",
  "messaging.discordHelp.not_linked": 'خادم Discord هذا غير مرتبط بخادم GoAhead هذا. اختر "إعادة الربط" لربطه.',
} as const satisfies PartialTranslation<typeof source>;
