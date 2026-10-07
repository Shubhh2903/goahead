import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "Bu Slack çalışma alanı bağlı değil.",
  "error.messaging.unsupported": "Bu bilgisayar Slack'e bağlanamıyor.",
  "error.messaging.relayUnavailable":
    "GoAhead bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.sendUnavailable": "Bu bilgisayarda Slack mesajı gönderme kullanılamıyor.",
  "error.messaging.sendNeedsSlack": "Bir mesaj yalnızca bir Slack konuşmasından taslak olarak oluşturulabilir.",
  "error.messaging.sendNeedsUser":
    "Ajanların mesaj gönderebilmesi için önce Slack çalışma alanını GoAhead'de kendiniz olarak bağlayın. Bir gönderimi yalnızca siz onaylayabilirsiniz.",
  "error.messaging.sendTargetInvalid": "Alıcı bir Slack kullanıcı kimliği veya kanal kimliği değil.",
  "error.messaging.sendToSelf":
    "GoAhead kullanıcısı bu konuşmayı okuyor. Ona mesaj göndermek yerine burada yanıtlayın.",
  "error.messaging.sendTextEmpty": "Mesajın metni yok.",
  "error.messaging.sendPaused": "Slack gönderimleri GoAhead'de duraklatıldı. Hiçbir şey gönderilmedi.",
  "error.messaging.sendRateLimited":
    "GoAhead son bir saatte gönderebileceği en fazla sayı olan {limit} Slack mesajını gönderdi. Hiçbir şey gönderilmedi. Daha sonra tekrar deneyin.",
  "error.messaging.sendQuietHours":
    "Sessiz saatler: GoAhead {time} saatine kadar Slack mesajı göndermez. Taslak bekler.",
  "error.messaging.threadUnavailable": "Bu Slack konuşması kullanılamıyor.",
  "error.messaging.inboxNeedsSlack": "Slack mesajları yalnızca GoAhead ile doğrudan mesajınızda okunabilir.",
  "error.messaging.inboxNeedsUser":
    "Ajanların Slack mesajlarınızı okuyabilmesi için Slack çalışma alanını GoAhead'de kendiniz olarak bağlayın.",
  "error.messaging.inboxOwnerOnly": "Slack mesajlarının okunmasını yalnızca GoAhead kullanıcısı isteyebilir.",
  "error.messaging.inboxUnknownConversation":
    "Bu Slack konuşması GoAhead gelen kutusunda yok. Tuttuğu konuşmaları görmek için slack_list_unread kullanın.",
} as const satisfies PartialTranslation<typeof source>;
