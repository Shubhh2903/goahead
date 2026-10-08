import { EventEmitter } from "node:events";
import { sourceText } from "@openbot/i18n/source";
import type { UpdateCancellationToken, UpdateCheckOutcome } from "./update-service";
import { UpdateService } from "./update-service";

/**
 * A simulated app update for development, so the update notification can be seen without a
 * packaged build or a release feed. `application-services.ts` uses it only when the app is not
 * packaged and `OPENBOT_DEV_UPDATE_SIMULATION=1`.
 *
 * Each check offers the next patch version of the running version. A download reports progress from
 * 0 to 100 over a few seconds. Nothing is downloaded, written, installed or quit:
 * `SimulatedUpdateService.installUpdate` refuses before the install starts, the same as a refusal
 * for another running session, so the update stays ready.
 */
export const DEV_UPDATE_SIMULATION_ENV = "OPENBOT_DEV_UPDATE_SIMULATION";

const PROGRESS_STEP = 5;
const PROGRESS_INTERVAL_MS = 200;

export function devUpdateSimulationEnabled(packaged: boolean, environment: NodeJS.ProcessEnv = process.env): boolean {
  return !packaged && environment[DEV_UPDATE_SIMULATION_ENV] === "1";
}

/** The next patch version, such as `0.32.1` for `0.32.0`. A version that is not SemVer gives `0.0.1`. */
export function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) return "0.0.1";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

class SimulatedCancellationToken implements UpdateCancellationToken {
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }
}

/** The `UpdateAdapter` that `UpdateService` drives, with no network and no files. */
export class SimulatedUpdater extends EventEmitter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #version: string;

  constructor(currentVersion: string) {
    super();
    this.#version = nextPatchVersion(currentVersion);
  }

  async checkForUpdates(): Promise<UpdateCheckOutcome> {
    return {
      isUpdateAvailable: true,
      updateInfo: { version: this.#version },
      cancellationToken: new SimulatedCancellationToken(),
    };
  }

  downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let percent = 0;
      const timer = setInterval(() => {
        if (cancellationToken?.cancelled) {
          clearInterval(timer);
          reject(new Error("The simulated download was cancelled."));
          return;
        }
        percent = Math.min(100, percent + PROGRESS_STEP);
        this.emit("download-progress", { percent, total: 100, transferred: percent, delta: PROGRESS_STEP });
        if (percent < 100) return;
        clearInterval(timer);
        this.emit("update-downloaded", { version: this.#version });
        resolve([]);
      }, PROGRESS_INTERVAL_MS);
    });
  }

  /** Never reached: `SimulatedUpdateService` refuses the install first. It does nothing either way. */
  quitAndInstall(): void {}
}

/** The update service with the install refused, so a simulated update never runs shutdown preparation. */
export class SimulatedUpdateService extends UpdateService {
  override async installUpdate(): Promise<void> {
    throw new Error(sourceText("error.update.simulationInstall"));
  }
}
