import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack artık bu çalışma alanında GoAhead'i kabul etmiyor. Kaldırılmış olabilir. Çalışma alanını tekrar bağlayın.",
  "messaging.help.secret_storage_unavailable":
    "GoAhead bu bilgisayardaki kayıtlı token'ları okuyamıyor. Çalışma alanı bağlantısını kesin, ardından tekrar bağlayın.",
  "messaging.help.relay_unavailable":
    "GoAhead bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, Sunucu ayarlarından bu bilgisayara bir ad verin ve GoAhead'i açık tutun.",
  "messaging.thread.label": "Slack konuşması: {title}",
  "messaging.thread.readOnly": "Salt okunur. Ajan bu konuşmayı Slack'te yanıtlar.",
  "messaging.thread.slackPerson": "Slack kullanıcısı",
  "messaging.thread.empty": "Henüz mesaj yok.",
  "messaging.thread.loadFailed": "Slack konuşması yüklenmedi.",
} as const satisfies PartialTranslation<typeof source>;
