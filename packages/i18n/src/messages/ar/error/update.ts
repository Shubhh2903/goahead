import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "التحديثات متاحة في إصدارات سطح المكتب المثبّتة.",
  "error.update.notReady": "لا يوجد تحديث جاهز للتثبيت.",
  "error.update.restartFailed": "تعذّر على GoAhead إعادة التشغيل لتثبيت التحديث.",
  "error.update.downloadStalled": "توقف تنزيل التحديث عن الاستجابة. حاول مرة أخرى.",
  "error.update.installFailed": "تعذّر تثبيت التحديث. أغلق GoAhead وأعد فتحه، ثم حاول مرة أخرى.",
  "error.update.notInstalled": "لم تُثبِّت إعادة التشغيل الأخيرة التحديث. أعد التشغيل للمحاولة مرة أخرى.",
  "error.update.downloadFailed": "تعذّر تنزيل التحديث. حاول مرة أخرى.",
  "error.update.signatureNotConfirmed":
    "تعذّر على GoAhead التحقق من التحديث. حاول مرة أخرى. إذا استمر هذا الخطأ، نزّل GoAhead من goahead.multicodegenius.com/download.",
  "error.update.checkFailed": "تعذّر التحقق من وجود تحديثات. حاول مرة أخرى.",
  "error.update.checkStalled": "توقف التحقق من التحديثات عن الاستجابة. حاول مرة أخرى.",
  "error.update.checkOffline": "تعذّر الوصول إلى خدمة التحديث. تحقق من اتصالك بالإنترنت، ثم حاول مرة أخرى.",
  "error.update.checkUnavailable": "لم تستجب خدمة التحديث. سيحاول GoAhead مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.checkNoRelease": "لم يُعثر على تحديث منشور لهذه المنصة. سيحاول GoAhead مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.managedByNix": "يثبّت Nix التحديثات لهذه النسخة من GoAhead. حدّثها باستخدام Nix.",
  "error.update.managedByHost": "يثبّت المضيف التحديثات على جهاز Mac هذا. يبقى التحديث جاهزًا حتى تُجرى صيانة المضيف.",
  "error.update.siblingSession":
    "لا تزال جلسة GoAhead أخرى تعمل من هذا التطبيق. أوقف GoAhead في كل حسابات مستخدمي macOS الأخرى أولًا، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingSessionSameAccount":
    "لا تزال عملية GoAhead أخرى تعمل في حساب المستخدم هذا. أغلقها، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingCheckFailed": "تعذّر التحقق من جلسات GoAhead الأخرى. حاول مرة أخرى قبل التثبيت.",
  "error.update.readOnlyLocation":
    "لا يمكن لـ GoAhead تثبيت التحديثات من هذا الموقع. أغلق GoAhead. في Finder، اسحب GoAhead إلى مجلد التطبيقات (إذا كان موجودًا هناك بالفعل، فاسحبه خارجه ثم أعده إليه). ثم افتح GoAhead وثبّت التحديث مرة أخرى.",
  "error.update.appImageMissing":
    "لا يستطيع GoAhead تثبيت التحديث لأن ملف AppImage الخاص به نُقل أو أُعيدت تسميته أو استُبدل. أغلق GoAhead، ثم افتح ملف AppImage مرة أخرى.",
  "error.update.appImageReadOnly":
    "لا يستطيع GoAhead تثبيت التحديثات في مجلد ملف AppImage الخاص به. أغلق GoAhead، وانقل ملف AppImage إلى مجلد داخل مجلدك الرئيسي، ثم افتحه وثبّت التحديث مرة أخرى.",
  "error.update.remoteDisabled": "التحديثات من مسؤولي الخوادم معطّلة على هذا الحاسوب.",
  "error.update.restartStarted": "يعيد GoAhead التشغيل بالفعل لتثبيت التحديث.",
  "error.update.alreadyRestarting": "يعيد GoAhead التشغيل بالفعل.",
} as const satisfies PartialTranslation<typeof source>;
