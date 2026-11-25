import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "GoAhead 无法启动",
  "startup.failedBody": "{message}\n\n你的本地数据没有被重置或覆盖。请查看故障排查指南了解恢复步骤。",
  "startup.archiveChangedTitle": "GoAhead 文件已被更改",
  "startup.archiveChangedBody":
    "另一个程序更改了 GoAhead 的文件 app.asar。GoAhead 现在仍在运行，但退出后将无法再次打开。\n\n要修复 GoAhead，请重新安装。你的本地数据会保留。",
  "startup.archiveChangedDownload": "下载 GoAhead",
  "startup.filesDamagedBody": "部分 GoAhead 文件已损坏或缺失。\n\n要修复 GoAhead，请重新安装。你的本地数据会保留。",
  "startup.newerDataUpdatingTitle": "正在更新 GoAhead",
  "startup.newerDataUpdatingBody":
    "较新版本的 GoAhead 保存了你的数据。GoAhead 将安装最新版本，然后重新打开。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataTitle": "请安装最新版 GoAhead",
  "startup.newerDataBody":
    "较新版本的 GoAhead 保存了你的数据，此版本（{version}）无法打开这些数据。请安装最新版本以打开你的数据。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataDownload": "下载 GoAhead",
  "startup.newerDataGuide": "打开指南",
  "startup.newerDataQuit": "退出",
  "startup.newerDataLoopTitle": "最新版本的 GoAhead 未能打开",
  "startup.newerDataLoopBody":
    "较新版本的 GoAhead 保存了你的数据，此版本（{version}）无法打开这些数据。GoAhead {loopVersion} 连续多次在打开前停止，因此不会再次安装它。\n\n请在有比 {loopVersion} 更新的版本时安装它。如需帮助，请打开指南。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataReleases": "查看版本",
  "startup.recoveryWindowTitle": "GoAhead 恢复",
  "startup.recoveryTitle": "GoAhead 未能打开",
  "startup.recoveryBody": {
    other: "GoAhead {version} 在打开前已连续 {count} 次停止。你的本地数据没有被重置或覆盖。",
  },
  "startup.recoveryHint": "请重试，或安装上一个能打开的版本。如需帮助，请导出诊断信息，并将文件随报告一起发送。",
  "startup.recoveryHintLatest":
    "GoAhead 未找到能打开你数据的早期版本。请重试，或安装最新版本。如需帮助，请导出诊断信息，并将文件随报告一起发送。",
  "startup.recoveryRetry": "重试",
  "startup.recoveryPreviousVersion": "下载上一个版本",
  "startup.recoveryLatestVersion": "下载最新版本",
  "startup.recoveryExportDiagnostics": "导出诊断信息",
  "startup.recoveryOpenDataFolder": "打开数据文件夹",
  "startup.recoveryQuit": "退出",
  "startup.recoveryDiagnosticsSaved": "诊断文件已保存。",
  "startup.recoveryActionFailed": "GoAhead 无法执行此操作。",
} as const satisfies PartialTranslation<typeof source>;
