import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espaço de trabalho do Slack não está conectado.",
  "error.messaging.unsupported": "Este computador não consegue se conectar ao Slack.",
  "error.messaging.relayUnavailable":
    "O GoAhead não consegue receber eventos do Slack neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.sendUnavailable": "O envio de mensagens do Slack não está disponível neste computador.",
  "error.messaging.sendNeedsSlack": "Uma mensagem só pode ser rascunhada a partir de uma conversa do Slack.",
  "error.messaging.sendNeedsUser":
    "Conecte o espaço de trabalho do Slack como você no GoAhead antes que os agentes possam enviar mensagens. Só você pode aprovar um envio.",
  "error.messaging.sendTargetInvalid": "O destinatário não é um id de usuário nem de canal do Slack.",
  "error.messaging.sendToSelf":
    "O usuário do GoAhead lê esta conversa. Responda aqui em vez de enviar uma mensagem para ele.",
  "error.messaging.sendTextEmpty": "A mensagem não tem texto.",
  "error.messaging.sendPaused": "Os envios do Slack estão pausados no GoAhead. Nada foi enviado.",
  "error.messaging.sendQuietHours":
    "Horário de silêncio: o GoAhead não envia mensagens do Slack até {time}. O rascunho aguarda.",
  "error.messaging.sendQuietHoursNoDraft":
    "Horário de silêncio: o GoAhead não envia mensagens do Slack até {time}. Nada foi enviado. Peça de novo depois das {time}.",
  "error.messaging.sendWorkspaceUnclear":
    "O destinatário não está em exatamente um dos seus workspaces do Slack. Nada foi enviado. Use um ID de usuário ou de canal de um workspace.",
  "error.messaging.threadUnavailable": "Esta conversa do Slack não está disponível.",
  "error.messaging.inboxNeedsSlack":
    "As mensagens do Slack só podem ser lidas na sua mensagem direta com o GoAhead ou quando você pede ao Slack Orchestrator no GoAhead neste computador.",
  "error.messaging.inboxNeedsUser":
    "Conecte o espaço de trabalho do Slack como você no GoAhead antes que os agentes possam ler suas mensagens do Slack.",
  "error.messaging.inboxOwnerOnly": "Só o usuário do GoAhead pode pedir para ler as mensagens do Slack dele.",
  "error.messaging.inboxUnknownConversation":
    "Essa conversa do Slack não está na caixa de entrada do GoAhead. Use slack_list_unread para ver as conversas que ele guarda.",
  "error.messaging.discordNotConnected": "Este servidor do Discord não está conectado.",
  "error.messaging.discordUnsupported": "Este computador não consegue se conectar ao Discord.",
  "error.messaging.discordRelayUnavailable":
    "O GoAhead não consegue receber eventos do Discord neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.discordRolesUnsupported":
    "O GoAhead ainda não consegue listar as funções do Discord. Tente novamente mais tarde.",
  "error.messaging.telegramNotConnected": "Este chat do Telegram não está conectado.",
  "error.messaging.telegramUnsupported": "Este computador não consegue se conectar ao Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "O GoAhead não consegue acessar o Telegram neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.telegramRelayUnreachable":
    "O GoAhead não consegue se conectar ao serviço dele neste computador. Verifique a conexão com a internet, a VPN, o proxy ou o firewall e tente novamente.",
  "error.messaging.telegramServiceUnavailable":
    "O GoAhead não consegue conectar o Telegram agora. Tente novamente mais tarde.",
  "error.messaging.whatsappNotConnected": "Este número do WhatsApp não está conectado.",
  "error.messaging.whatsappUnsupported": "Este computador não consegue se conectar ao WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Um número do WhatsApp pode permitir até 200 contatos e grupos.",
  "error.messaging.whatsappNumberNotFound":
    "Este número não tem conta no WhatsApp. Digite-o com o código do país, como +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Este contato ou grupo não está mais na lista.",
  "error.messaging.whatsappRequestEnded":
    "Esta solicitação terminou. Peça para a pessoa escrever de novo para receber um novo código.",
  "error.messaging.memoryLimit": "Um espaço de trabalho conectado pode ter até {limit} memórias. Exclua uma primeiro.",
} as const satisfies PartialTranslation<typeof source>;
