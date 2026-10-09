/**
 * Writes one Dock icon for each emotion face in `build/emotions/`, from the static SVG files in
 * `packages/brand/src/emotions/static`.
 *
 * macOS has no API to animate the Dock icon, so the app sets one of these still images while it
 * runs. The files are committed, like `build/logo-colors`: a designer can replace one by hand.
 *
 * The icon is 1024 x 1024 with the macOS safe area: the rounded square fills 824 px in the center,
 * with 100 px of transparent margin, the same ratio as `build/icon-production-macos-safe-area.png`.
 * In the SVG, the square fills x and y 8-120 of the 128-unit canvas.
 *
 * Run with `bun scripts/generate-emotion-dock-icons.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EMOTION_IDS, emotionDockIconFileName } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "packages/brand/src/emotions/static");
const OUTPUT = join(ROOT, "build/emotions");
const logger = createOpenBotLogger("generate-emotion-dock-icons");

const ICON_SIZE = 1024;
/** The macOS icon grid: the icon body is 824 px of the 1024 px canvas. */
const BODY_SIZE = 824;
const SVG_CANVAS = 128;
const SVG_BODY = 112;

/** The rendered SVG size, so that its 112-unit square becomes the 824 px body. */
const RENDER_SIZE = Math.round((SVG_CANVAS * BODY_SIZE) / SVG_BODY);
const MARGIN = (ICON_SIZE - RENDER_SIZE) / 2;
if (!Number.isInteger(MARGIN)) throw new Error("The icon margin must be a whole number of pixels.");

await mkdir(OUTPUT, { recursive: true });
for (const id of EMOTION_IDS) {
  const svg = await readFile(join(SOURCE, `${id}.svg`));
  const png = await sharp(svg, { density: (72 * RENDER_SIZE) / SVG_CANVAS })
    .resize(RENDER_SIZE, RENDER_SIZE)
    .extend({
      top: MARGIN,
      bottom: MARGIN,
      left: MARGIN,
      right: MARGIN,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const name = emotionDockIconFileName(id);
  await writeFile(join(OUTPUT, name), png);
  logger.info(`Wrote build/emotions/${name}`);
}
