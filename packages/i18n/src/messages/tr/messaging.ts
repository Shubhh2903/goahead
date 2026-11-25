import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack artık bu çalışma alanında GoAhead'i kabul etmiyor. Kaldırılmış olabilir. Çalışma alanını tekrar bağlayın.",
  "messaging.help.secret_storage_unavailable":
    "GoAhead bu bilgisayardaki kayıtlı belirteçleri okuyamıyor. Çalışma alanı bağlantısını kesin, ardından tekrar bağlayın.",
  "messaging.help.relay_unavailable":
    "GoAhead bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, Sunucu ayarlarından bu bilgisayara bir ad verin ve GoAhead'u açık tutun.",
  "messaging.thread.label": "Slack konuşması: {title}",
  "messaging.thread.readOnly": "Salt okunur. Ajan bu konuşmayı Slack'te yanıtlar.",
  "messaging.thread.slackPerson": "Slack kullanıcısı",
  "messaging.thread.empty": "Henüz mesaj yok.",
  "messaging.thread.loadFailed": "Slack konuşması yüklenmedi.",
  "messaging.draft.label": "{recipient} için mesaj taslağı",
  "messaging.draft.title": "Mesaj onayınızı bekliyor",
  "messaging.draft.to": "Alıcı: {recipient}",
  "messaging.draft.asUser": "sizin adınıza gönderilir",
  "messaging.draft.asBot": "GoAhead olarak gönderilir",
  "messaging.draft.requestedBy": "{name} istedi",
  "messaging.draft.textLabel": "Mesaj metni",
  "messaging.draft.approve": "Onayla ve gönder",
  "messaging.draft.deny": "Reddet",
  "messaging.draft.sending": "Gönderiliyor…",
  "messaging.draft.failed": "Taslak yanıtlanamadı.",
  "messaging.inbox.title": "Slack gelen kutusu",
  "messaging.inbox.conversations": "Gelen kutusu konuşmaları",
  "messaging.inbox.messages": "Mesajlar",
  "messaging.inbox.empty":
    "Henüz Slack mesajı yok. GoAhead doğrudan mesajlarınızı, grup mesajlarınızı, bahsedilmelerinizi ve seçtiğiniz kanalları tutar.",
  "messaging.inbox.choose": "Okumak için bir konuşma seçin.",
  "messaging.inbox.loadFailed": "Slack gelen kutusu yüklenmedi.",
  "messaging.inbox.unread": { one: "{count} okunmamış", other: "{count} okunmamış" },
  "messaging.help.not_linked": "Bu çalışma alanı bu sunucuya bağlı değil. Bağlamak için Yeniden bağlan'ı seçin.",
  "messaging.discordHelp.invalid_token":
    "Discord artık bu Discord sunucusunda GoAhead'u kabul etmiyor. Kaldırılmış olabilir. Discord sunucusunu tekrar bağlayın.",
  "messaging.discordHelp.secret_storage_unavailable":
    "GoAhead bu bilgisayardaki kayıtlı belirteçleri okuyamıyor. Discord sunucusu bağlantısını kesin, ardından tekrar bağlayın.",
  "messaging.discordHelp.relay_unavailable":
    "GoAhead bu bilgisayarda Discord etkinliklerini alamıyor. Oturum açın, Sunucu ayarlarından bu bilgisayara bir ad verin ve GoAhead'u açık tutun.",
  "messaging.discordHelp.not_linked":
    "Bu Discord sunucusu bu GoAhead sunucusuna bağlı değil. Bağlamak için Yeniden bağlan'ı seçin.",
} as const satisfies PartialTranslation<typeof source>;
