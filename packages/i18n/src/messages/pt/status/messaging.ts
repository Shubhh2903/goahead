import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Trabalhando nisso…",
  "status.messaging.queued": "Aguardando: o GoAhead está atendendo outra solicitação. A resposta chegará aqui.",
  "status.messaging.busy": "Há muitas solicitações na fila. Tente novamente mais tarde.",
  "status.messaging.failed":
    "O GoAhead não conseguiu concluir esta solicitação. Os detalhes estão no computador anfitrião do GoAhead.",
  "status.messaging.noAnswer": "O GoAhead terminou sem uma resposta por escrito.",
  "status.messaging.noAgent": "Nenhum agente pode responder aqui ainda. Adicione o Orquestrador do Slack no GoAhead.",
  "status.messaging.delegated": "Um colega está trabalhando nisso. A resposta chegará aqui.",
  "status.messaging.stopped": "Interrompido.",
  "status.messaging.stop": "Interromper",
  "status.messaging.approvalTitle": "O GoAhead pede aprovação para continuar.",
  "status.messaging.approvalCommand": "Executar um comando",
  "status.messaging.approvalFileChange": "Alterar arquivos",
  "status.messaging.approvalPermissions": "Obter mais permissões",
  "status.messaging.approve": "Aprovar",
  "status.messaging.deny": "Negar",
  "status.messaging.approvedBy": "Aprovado por {user}.",
  "status.messaging.deniedBy": "Negado por {user}.",
  "status.messaging.answeredOnHost": "Respondido no computador anfitrião do GoAhead.",
  "status.messaging.requestInactive": "Esta solicitação não está mais ativa.",
  "status.messaging.onlyRequester":
    "Somente {user} pode fazer isso. Também é possível responder no computador anfitrião do GoAhead.",
  "status.messaging.hostOnly": "Esta solicitação só pode ser respondida no computador anfitrião do GoAhead.",
  "status.messaging.filesSkipped": "Alguns arquivos não foram enviados: {names}.",
  "status.messaging.orchestratorName": "Orquestrador do Slack",
  "status.messaging.orchestratorTitle": "Responde no Slack e consulta a equipe",
  "status.messaging.integrationsSection": "Integrações",
  "status.messaging.signInReceived": "O GoAhead recebeu a instalação do Slack. Você pode fechar esta aba.",
  "status.messaging.signInUnknown":
    "O GoAhead não iniciou esta instalação do Slack. Inicie a instalação novamente no GoAhead.",
  "status.messaging.sendDraftTitle": "O GoAhead pede aprovação para enviar uma mensagem.",
  "status.messaging.sendDraftTo": "Para: {to}",
  "status.messaging.sendAsUser": "Como: {user}",
  "status.messaging.sendAsBot": "Enviada pelo aplicativo GoAhead, não como você.",
  "status.messaging.sent": "Enviada. Aprovada por {user}.",
  "status.messaging.sendFailed": "Não enviada: {reason}",
  "status.messaging.sentFor": "{name} me pediu para enviar isto:",
} as const satisfies PartialTranslation<typeof source>;
