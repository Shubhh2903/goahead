import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espaço de trabalho do Slack não está conectado.",
  "error.messaging.unsupported": "Este computador não consegue se conectar ao Slack.",
  "error.messaging.relayUnavailable":
    "O GoAhead não consegue receber eventos do Slack neste computador. Entre, dê um nome a este computador e tente novamente.",
  "error.messaging.sendUnavailable": "O envio de mensagens do Slack não está disponível neste computador.",
  "error.messaging.sendNeedsSlack": "Uma mensagem só pode ser rascunhada a partir de uma conversa do Slack.",
  "error.messaging.sendNeedsUser":
    "Conecte o espaço de trabalho do Slack como você no GoAhead antes que os agentes possam enviar mensagens. Só você pode aprovar um envio.",
  "error.messaging.sendTargetInvalid": "O destinatário não é um id de usuário nem de canal do Slack.",
  "error.messaging.sendToSelf":
    "O usuário do GoAhead lê esta conversa. Responda aqui em vez de enviar uma mensagem para ele.",
  "error.messaging.sendTextEmpty": "A mensagem não tem texto.",
} as const satisfies PartialTranslation<typeof source>;
