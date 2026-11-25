import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Ci sto lavorando…",
  "status.messaging.queued": "In attesa che finisca una richiesta precedente. La risposta arriva qui.",
  "status.messaging.busy": "Ci sono troppe richieste in attesa. Riprova più tardi.",
  "status.messaging.failed":
    "GoAhead non è riuscito a completare questa richiesta. I dettagli sono sull'host di GoAhead.",
  "status.messaging.noAnswer": "GoAhead ha finito senza una risposta scritta.",
  "status.messaging.noAgent": "Nessun agente può ancora rispondere qui. Aggiungi lo Slack Orchestrator in GoAhead.",
  "status.messaging.delegated": "Un collega ci sta lavorando. La risposta arriva qui.",
  "status.messaging.stopped": "Interrotto.",
  "status.messaging.stop": "Interrompi",
  "status.messaging.approvalTitle": "GoAhead chiede l'approvazione per continuare.",
  "status.messaging.approvalTitleTeammate": "Il collega {agent} chiede l'approvazione per continuare.",
  "status.messaging.approvalCommand": "Eseguire un comando",
  "status.messaging.approvalFileChange": "Modificare dei file",
  "status.messaging.approvalPermissions": "Ottenere altri permessi",
  "status.messaging.approve": "Approva",
  "status.messaging.deny": "Rifiuta",
  "status.messaging.approvedBy": "Approvato da {user}.",
  "status.messaging.deniedBy": "Rifiutato da {user}.",
  "status.messaging.answeredOnHost": "Risposta data sull'host di GoAhead.",
  "status.messaging.requestInactive": "Questa richiesta non è più attiva.",
  "status.messaging.onlyRequester": "Solo {user} può farlo. Può rispondere anche l'host di GoAhead.",
  "status.messaging.hostOnly": "Solo l'host di GoAhead può rispondere a questa richiesta.",
  "status.messaging.filesSkipped": "Alcuni file non sono stati inviati: {names}.",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Risponde su Slack e consulta il team",
  "status.messaging.discordNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il Discord Orchestrator in GoAhead.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Risponde su Discord e consulta il team",
  "status.messaging.integrationsSection": "Integrazioni",
  "status.messaging.signInReceived": "GoAhead ha ricevuto l'installazione di Slack. Puoi chiudere questa scheda.",
  "status.messaging.signInUnknown": "GoAhead non ha avviato questa installazione di Slack. Riavviala in GoAhead.",
  "status.messaging.telegramNoAgent":
    "Nessun agente può ancora rispondere qui. In GoAhead, apri Marketplace > App > Telegram e fai clic su Aggiungi agente.",
  "status.messaging.telegramLinked":
    "GoAhead è collegato a questa chat. Menziona {bot} o rispondi a un messaggio di GoAhead per interpellare gli agenti.",
  "status.messaging.telegramNotLinked":
    "GoAhead non è collegato a questa chat. Per collegarlo, apri l’app GoAhead, vai su Marketplace → App → Telegram e seleziona «Aggiungi a un gruppo» o «Apri una chat diretta».",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Risponde su Telegram e consulta il team",
  "status.messaging.whatsappNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il WhatsApp Orchestrator in GoAhead.",
  "status.messaging.whatsappApprovalMenu": "Rispondi 1 per approvare o 2 per rifiutare.",
  "status.messaging.whatsappStopMenu": "Rispondi «stop» per interrompere.",
  "status.messaging.whatsappPairingCode":
    "Questo numero risponde solo alle persone autorizzate dal proprietario. Dai questo codice al proprietario: {code}",
  "status.messaging.whatsappPairingApproved": "Ora puoi inviare richieste a questo numero.",
  "status.messaging.whatsappOwnChat": "Messaggio a te stesso",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *GoAhead è collegato*\n\nScrivi qui per chiedere ai tuoi agenti. Il WhatsApp Orchestrator risponde o passa il lavoro all'agente giusto.\n\nInvia *stop* per fermare una richiesta.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *GoAhead è collegato*\n\nLe persone che autorizzi in GoAhead ora possono scrivere a questo numero. Una persona nuova riceve un codice: approvalo in GoAhead, in Richieste.\n\nInvia *stop* per fermare una richiesta.",
  "status.messaging.whatsappOtherOpenBot":
    "Un altro GoAhead è collegato a questo numero WhatsApp, quindi puoi ricevere due risposte. Per risolvere, apri Dispositivi collegati in WhatsApp sul telefono ed esci dall’GoAhead che non usi.",
  "status.messaging.whatsappPaused":
    "GoAhead non risponde qui per 10 minuti: sono arrivati troppi messaggi in poco tempo. Se un altro GoAhead è collegato a questo numero, apri Dispositivi collegati in WhatsApp sul telefono ed esci dall’GoAhead che non usi.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Risponde su WhatsApp e consulta il team",
} as const satisfies PartialTranslation<typeof source>;
