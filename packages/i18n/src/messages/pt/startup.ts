import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "O GoAhead não conseguiu iniciar",
  "startup.failedBody":
    "{message}\n\nSeus dados locais não foram redefinidos nem sobrescritos. Consulte o guia de solução de problemas para ver os passos de recuperação.",
  "startup.archiveChangedTitle": "Arquivos do GoAhead foram alterados",
  "startup.archiveChangedBody":
    "Outro programa alterou o arquivo app.asar do GoAhead. O GoAhead funciona agora, mas não vai abrir depois que você fechá-lo.\n\nPara reparar, instale o GoAhead novamente. Seus dados locais são mantidos.",
  "startup.archiveChangedDownload": "Baixar GoAhead",
  "startup.filesDamagedBody":
    "Alguns arquivos do GoAhead estão danificados ou faltando.\n\nPara reparar, instale o GoAhead novamente. Seus dados locais são mantidos.",
  "startup.newerDataUpdatingTitle": "Atualizando o GoAhead",
  "startup.newerDataUpdatingBody":
    "Uma versão mais recente do GoAhead salvou seus dados. O GoAhead instala a versão mais recente e depois abre de novo.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataTitle": "Instale o GoAhead mais recente",
  "startup.newerDataBody":
    "Uma versão mais recente do GoAhead salvou seus dados, e esta versão ({version}) não consegue abri-los. Instale a versão mais recente para abrir seus dados.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataDownload": "Baixar GoAhead",
  "startup.newerDataGuide": "Abrir guia",
  "startup.newerDataQuit": "Sair",
  "startup.newerDataLoopTitle": "A versão mais recente do GoAhead não abriu",
  "startup.newerDataLoopBody":
    "Uma versão mais recente do GoAhead salvou seus dados, e esta versão ({version}) não consegue abri-los. O GoAhead {loopVersion} parou antes de abrir várias vezes seguidas, então ele não será instalado de novo.\n\nInstale uma versão mais recente que a {loopVersion} quando houver uma disponível. Para obter ajuda, abra o guia.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataReleases": "Ver versões",
  "startup.recoveryWindowTitle": "Recuperação do GoAhead",
  "startup.recoveryTitle": "O GoAhead não abriu",
  "startup.recoveryBody": {
    one: "O GoAhead {version} parou antes de abrir, {count} vez seguida. Seus dados locais não foram redefinidos nem substituídos.",
    other:
      "O GoAhead {version} parou antes de abrir, {count} vezes seguidas. Seus dados locais não foram redefinidos nem substituídos.",
  },
  "startup.recoveryHint":
    "Tente novamente ou instale a última versão que abriu. Para obter ajuda, exporte o diagnóstico e envie o arquivo com seu relato.",
  "startup.recoveryHintLatest":
    "O GoAhead não encontrou uma versão anterior que consiga abrir seus dados. Tente novamente ou instale a versão mais recente. Para obter ajuda, exporte o diagnóstico e envie o arquivo com seu relato.",
  "startup.recoveryRetry": "Tentar de novo",
  "startup.recoveryPreviousVersion": "Baixar versão anterior",
  "startup.recoveryLatestVersion": "Baixar versão mais recente",
  "startup.recoveryExportDiagnostics": "Exportar diagnóstico",
  "startup.recoveryOpenDataFolder": "Abrir pasta de dados",
  "startup.recoveryQuit": "Sair",
  "startup.recoveryDiagnosticsSaved": "O arquivo de diagnóstico foi salvo.",
  "startup.recoveryActionFailed": "O GoAhead não conseguiu fazer esta ação.",
} as const satisfies PartialTranslation<typeof source>;
