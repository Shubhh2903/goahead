import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "対応しています…",
  "status.messaging.queued": "待機中: 前のリクエストの完了を待っています。回答はここに届きます。",
  "status.messaging.busy": "待機中のリクエストが多すぎます。しばらくしてからもう一度お試しください。",
  "status.messaging.failed": "GoAhead はこのリクエストを完了できませんでした。詳細は GoAhead のホストにあります。",
  "status.messaging.noAnswer": "GoAhead はテキストの回答を返さずに終了しました。",
  "status.messaging.noAgent":
    "ここで回答できるエージェントはまだいません。GoAhead で Slack Orchestrator を追加してください。",
  "status.messaging.delegated": "チームメイトが対応しています。回答はここに届きます。",
  "status.messaging.stopped": "停止しました。",
  "status.messaging.stop": "停止",
  "status.messaging.approvalTitle": "GoAhead が続行の承認を求めています。",
  "status.messaging.approvalTitleTeammate": "チームメイトの {agent} が続行の承認を求めています。",
  "status.messaging.approvalCommand": "コマンドを実行",
  "status.messaging.approvalFileChange": "ファイルを変更",
  "status.messaging.approvalPermissions": "追加の権限を取得",
  "status.messaging.approve": "承認",
  "status.messaging.deny": "拒否",
  "status.messaging.approvedBy": "{user} が承認しました。",
  "status.messaging.deniedBy": "{user} が拒否しました。",
  "status.messaging.answeredOnHost": "GoAhead のホストで回答されました。",
  "status.messaging.requestInactive": "このリクエストはもう有効ではありません。",
  "status.messaging.onlyRequester": "これを行えるのは {user} だけです。GoAhead のホストでも回答できます。",
  "status.messaging.hostOnly": "このリクエストに回答できるのは GoAhead のホストだけです。",
  "status.messaging.filesSkipped": "一部のファイルは送信されませんでした: {names}。",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Slack で回答し、チームに依頼します",
  "status.messaging.discordNoAgent":
    "ここで回答できるエージェントはまだいません。GoAhead で Discord Orchestrator を追加してください。",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Discord で回答し、チームに依頼します",
  "status.messaging.integrationsSection": "連携",
  "status.messaging.signInReceived": "GoAhead は Slack のインストールを受け取りました。このタブは閉じてかまいません。",
  "status.messaging.signInUnknown":
    "この Slack のインストールは GoAhead が開始したものではありません。GoAhead でもう一度開始してください。",
  "status.messaging.telegramNoAgent":
    "ここで回答できるエージェントはまだいません。GoAhead で マーケットプレイス > アプリ > Telegram を開き、エージェントを追加 をクリックしてください。",
  "status.messaging.telegramLinked":
    "GoAhead はこのチャットに接続されています。エージェントに依頼するには、{bot} をメンションするか、GoAhead のメッセージに返信してください。",
  "status.messaging.telegramNotLinked":
    "GoAhead はこのチャットに接続されていません。接続するには、GoAhead アプリを開き、マーケットプレイス → アプリ → Telegram で「グループに追加」または「ダイレクトチャットを開く」を選択してください。",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Telegram で回答し、チームに依頼します",
  "status.messaging.whatsappNoAgent":
    "ここで回答できるエージェントはまだいません。GoAhead で WhatsApp Orchestrator を追加してください。",
  "status.messaging.whatsappApprovalMenu": "承認する場合は 1、拒否する場合は 2 と返信してください。",
  "status.messaging.whatsappStopMenu": "停止するには「stop」と返信してください。",
  "status.messaging.whatsappPairingCode":
    "この番号は、所有者が許可した人にだけ回答します。所有者にこのコードを伝えてください: {code}",
  "status.messaging.whatsappPairingApproved": "この番号にリクエストを送れるようになりました。",
  "status.messaging.whatsappOwnChat": "自分にメッセージ",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *GoAhead が接続しました*\n\nここに書いてエージェントに依頼できます。WhatsApp Orchestrator が答えるか、適切なエージェントに仕事を渡します。\n\n依頼を止めるには *stop* と送ってください。",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *GoAhead が接続しました*\n\nOpenBot で許可した人がこの番号に書けるようになりました。新しい人にはコードが届きます。GoAhead の「リクエスト」で承認してください。\n\n依頼を止めるには *stop* と送ってください。",
  "status.messaging.whatsappOtherOpenBot":
    "この WhatsApp 番号には別の GoAhead もリンクされているため、回答が 2 件届くことがあります。直すには、スマートフォンの WhatsApp で「リンク済みデバイス」を開き、使っていない GoAhead をログアウトしてください。",
  "status.messaging.whatsappPaused":
    "短時間にメッセージが多すぎたため、GoAhead はここで 10 分間応答を止めています。この番号に別の GoAhead もリンクされている場合は、スマートフォンの WhatsApp で「リンク済みデバイス」を開き、使っていない GoAhead をログアウトしてください。",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "WhatsApp で回答し、チームに依頼します",
} as const satisfies PartialTranslation<typeof source>;
