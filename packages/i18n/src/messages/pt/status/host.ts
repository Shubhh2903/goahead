import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Este GoAhead foi registrado para acesso por WebRTC.",
  "status.host.identityUpdated": "Identidade do servidor atualizada.",
  "status.host.starting": "Iniciando o computador anfitrião WebRTC…",
  "status.host.ready": "Este GoAhead está pronto para conexões WebRTC.",
  "status.host.stopping": "Tornando este GoAhead privado…",
  "status.host.private": "Este GoAhead é privado.",
} as const satisfies PartialTranslation<typeof source>;
