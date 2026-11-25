import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
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
  "error.messaging.sendQuietHours":
    "Sessiz saatler: GoAhead {time} saatine kadar Slack mesajı göndermez. Taslak bekler.",
  "error.messaging.sendQuietHoursNoDraft":
    "Sessiz saatler: GoAhead {time} saatine kadar Slack mesajı göndermez. Hiçbir şey gönderilmedi. {time} sonrasında tekrar isteyin.",
  "error.messaging.sendWorkspaceUnclear":
    "Alıcı, Slack çalışma alanlarınızdan tam olarak birinde değil. Hiçbir şey gönderilmedi. Tek bir çalışma alanından bir kullanıcı veya kanal kimliği kullanın.",
  "error.messaging.threadUnavailable": "Bu Slack konuşması kullanılamıyor.",
  "error.messaging.inboxNeedsSlack":
    "Slack mesajları yalnızca GoAhead ile doğrudan mesajınızda veya bu bilgisayardaki GoAhead'te Slack Orchestrator'a sorduğunuzda okunabilir.",
  "error.messaging.inboxNeedsUser":
    "Ajanların Slack mesajlarınızı okuyabilmesi için Slack çalışma alanını GoAhead'de kendiniz olarak bağlayın.",
  "error.messaging.inboxOwnerOnly": "Slack mesajlarının okunmasını yalnızca GoAhead kullanıcısı isteyebilir.",
  "error.messaging.inboxUnknownConversation":
    "Bu Slack konuşması GoAhead gelen kutusunda yok. Tuttuğu konuşmaları görmek için slack_list_unread kullanın.",
  "error.messaging.discordNotConnected": "Bu Discord sunucusu bağlı değil.",
  "error.messaging.discordUnsupported": "Bu bilgisayar Discord'a bağlanamıyor.",
  "error.messaging.discordRelayUnavailable":
    "GoAhead bu bilgisayarda Discord etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.discordRolesUnsupported":
    "GoAhead henüz Discord rollerini listeleyemiyor. Daha sonra yeniden deneyin.",
  "error.messaging.telegramNotConnected": "Bu Telegram sohbeti bağlı değil.",
  "error.messaging.telegramUnsupported": "Bu bilgisayar Telegram'a bağlanamıyor.",
  "error.messaging.telegramRelayUnavailable":
    "GoAhead bu bilgisayarda Telegram'a ulaşamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.telegramRelayUnreachable":
    "GoAhead bu bilgisayardan hizmetine bağlanamıyor. İnternet bağlantısını, VPN'i, proxy'yi veya güvenlik duvarını kontrol edin ve tekrar deneyin.",
  "error.messaging.telegramServiceUnavailable": "GoAhead şu anda Telegram'ı bağlayamıyor. Daha sonra tekrar deneyin.",
  "error.messaging.whatsappNotConnected": "Bu WhatsApp numarası bağlı değil.",
  "error.messaging.whatsappUnsupported": "Bu bilgisayar WhatsApp'a bağlanamıyor.",
  "error.messaging.whatsappTooManySenders": "Bir WhatsApp numarası en fazla 200 kişiye ve gruba izin verebilir.",
  "error.messaging.whatsappNumberNotFound":
    "Bu numaranın WhatsApp hesabı yok. Numarayı ülke koduyla yazın, örneğin +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Bu kişi veya grup artık listede değil.",
  "error.messaging.whatsappRequestEnded": "Bu istek sona erdi. Yeni bir kod için kişiden tekrar yazmasını isteyin.",
  "error.messaging.memoryLimit": "Bağlı bir çalışma alanı en fazla {limit} belleğe sahip olabilir. Önce birini silin.",
} as const satisfies PartialTranslation<typeof source>;
