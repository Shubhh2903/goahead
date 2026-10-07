import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "O Slack não aceita mais o GoAhead neste espaço de trabalho. Ele pode ter sido desinstalado. Conecte o espaço de trabalho novamente.",
  "messaging.help.secret_storage_unavailable":
    "O GoAhead não consegue ler os tokens salvos neste computador. Desconecte o espaço de trabalho e conecte-o novamente.",
  "messaging.help.relay_unavailable":
    "O GoAhead não consegue receber eventos do Slack neste computador. Entre na sua conta, dê um nome a este computador nas configurações do servidor e mantenha o GoAhead aberto.",
  "messaging.thread.label": "Conversa do Slack: {title}",
  "messaging.thread.readOnly": "Somente leitura. O agente responde a esta conversa no Slack.",
  "messaging.thread.slackPerson": "Usuário do Slack",
  "messaging.thread.empty": "Ainda não há mensagens.",
  "messaging.thread.loadFailed": "A conversa do Slack não carregou.",
  "messaging.draft.label": "Rascunho de mensagem para {recipient}",
  "messaging.draft.title": "Mensagem aguarda sua aprovação",
  "messaging.draft.to": "Para {recipient}",
  "messaging.draft.asUser": "enviada como você",
  "messaging.draft.asBot": "enviada como GoAhead",
  "messaging.draft.requestedBy": "{name} pediu",
  "messaging.draft.textLabel": "Texto da mensagem",
  "messaging.draft.approve": "Aprovar e enviar",
  "messaging.draft.deny": "Recusar",
  "messaging.draft.sending": "Enviando…",
  "messaging.draft.failed": "Não foi possível responder ao rascunho.",
} as const satisfies PartialTranslation<typeof source>;
