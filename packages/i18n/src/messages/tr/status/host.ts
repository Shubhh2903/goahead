import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Bu GoAhead, WebRTC erişimi için kaydedildi.",
  "status.host.identityUpdated": "Sunucu kimliği güncellendi.",
  "status.host.starting": "WebRTC ana makinesi başlatılıyor…",
  "status.host.ready": "Bu GoAhead, WebRTC bağlantıları için hazır.",
  "status.host.stopping": "Bu GoAhead gizli yapılıyor…",
  "status.host.private": "Bu GoAhead gizli.",
} as const satisfies PartialTranslation<typeof source>;
