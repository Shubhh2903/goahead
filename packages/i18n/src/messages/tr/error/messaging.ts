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
  "error.messaging.threadUnavailable": "Bu Slack konuşması kullanılamıyor.",
} as const satisfies PartialTranslation<typeof source>;
