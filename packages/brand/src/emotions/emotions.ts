// The emotion faces that the Dynamic Island shows, from the yellow emotions kit. Each face has an
// animated SVG (CSS keyframes inside the file) and a static SVG for Reduce Motion. The files are
// trusted repository assets; the Dock uses PNG files rendered from the static set
// (`scripts/generate-emotion-dock-icons.ts`, `emotionDockIconFileName`).
import type { EmotionId } from "@openbot/contracts/ipc";
import confusedAnimated from "./animated/confused.svg?raw";
import curiousAnimated from "./animated/curious.svg?raw";
import cuteAnimated from "./animated/cute.svg?raw";
import dizzyAnimated from "./animated/dizzy.svg?raw";
import doubtfulAnimated from "./animated/doubtful.svg?raw";
import focusedAnimated from "./animated/focused.svg?raw";
import happyAnimated from "./animated/happy.svg?raw";
import joyAnimated from "./animated/joy.svg?raw";
import learnedAnimated from "./animated/learned.svg?raw";
import listeningAnimated from "./animated/listening.svg?raw";
import lovedAnimated from "./animated/loved.svg?raw";
import moneyAnimated from "./animated/money.svg?raw";
import needsYouAnimated from "./animated/needs-you.svg?raw";
import neutralAnimated from "./animated/neutral.svg?raw";
import oopsAnimated from "./animated/oops.svg?raw";
import sadAnimated from "./animated/sad.svg?raw";
import sleepyAnimated from "./animated/sleepy.svg?raw";
import strainAnimated from "./animated/strain.svg?raw";
import surprisedAnimated from "./animated/surprised.svg?raw";
import thinkingAnimated from "./animated/thinking.svg?raw";
import unamusedAnimated from "./animated/unamused.svg?raw";
import winkAnimated from "./animated/wink.svg?raw";
import config from "./emotions.config.json";
import confusedStatic from "./static/confused.svg?raw";
import curiousStatic from "./static/curious.svg?raw";
import cuteStatic from "./static/cute.svg?raw";
import dizzyStatic from "./static/dizzy.svg?raw";
import doubtfulStatic from "./static/doubtful.svg?raw";
import focusedStatic from "./static/focused.svg?raw";
import happyStatic from "./static/happy.svg?raw";
import joyStatic from "./static/joy.svg?raw";
import learnedStatic from "./static/learned.svg?raw";
import listeningStatic from "./static/listening.svg?raw";
import lovedStatic from "./static/loved.svg?raw";
import moneyStatic from "./static/money.svg?raw";
import needsYouStatic from "./static/needs-you.svg?raw";
import neutralStatic from "./static/neutral.svg?raw";
import oopsStatic from "./static/oops.svg?raw";
import sadStatic from "./static/sad.svg?raw";
import sleepyStatic from "./static/sleepy.svg?raw";
import strainStatic from "./static/strain.svg?raw";
import surprisedStatic from "./static/surprised.svg?raw";
import thinkingStatic from "./static/thinking.svg?raw";
import unamusedStatic from "./static/unamused.svg?raw";
import winkStatic from "./static/wink.svg?raw";

export { EMOTION_IDS, type EmotionId, emotionDockIconFileName, isEmotionId } from "@openbot/contracts/ipc";

/** The catalog key of the accessible name of each face, such as "GoAhead: focused". */
export type EmotionLabelKey = `island.emotion.${EmotionId}`;

// Literal keys, so that `scripts/i18n-check.ts` finds each key in use (docs/i18n.md).
const EMOTION_LABEL_KEY = {
  neutral: "island.emotion.neutral",
  happy: "island.emotion.happy",
  joy: "island.emotion.joy",
  cute: "island.emotion.cute",
  wink: "island.emotion.wink",
  loved: "island.emotion.loved",
  listening: "island.emotion.listening",
  thinking: "island.emotion.thinking",
  focused: "island.emotion.focused",
  curious: "island.emotion.curious",
  confused: "island.emotion.confused",
  surprised: "island.emotion.surprised",
  doubtful: "island.emotion.doubtful",
  unamused: "island.emotion.unamused",
  strain: "island.emotion.strain",
  sad: "island.emotion.sad",
  oops: "island.emotion.oops",
  dizzy: "island.emotion.dizzy",
  sleepy: "island.emotion.sleepy",
  learned: "island.emotion.learned",
  money: "island.emotion.money",
  "needs-you": "island.emotion.needs-you",
} as const satisfies { [K in EmotionId]: `island.emotion.${K}` };

export function emotionLabelKey(id: EmotionId): EmotionLabelKey {
  return EMOTION_LABEL_KEY[id];
}

const ANIMATED_SVG: Record<EmotionId, string> = {
  neutral: neutralAnimated,
  happy: happyAnimated,
  joy: joyAnimated,
  cute: cuteAnimated,
  wink: winkAnimated,
  loved: lovedAnimated,
  listening: listeningAnimated,
  thinking: thinkingAnimated,
  focused: focusedAnimated,
  curious: curiousAnimated,
  confused: confusedAnimated,
  surprised: surprisedAnimated,
  doubtful: doubtfulAnimated,
  unamused: unamusedAnimated,
  strain: strainAnimated,
  sad: sadAnimated,
  oops: oopsAnimated,
  dizzy: dizzyAnimated,
  sleepy: sleepyAnimated,
  learned: learnedAnimated,
  money: moneyAnimated,
  "needs-you": needsYouAnimated,
};

const STATIC_SVG: Record<EmotionId, string> = {
  neutral: neutralStatic,
  happy: happyStatic,
  joy: joyStatic,
  cute: cuteStatic,
  wink: winkStatic,
  loved: lovedStatic,
  listening: listeningStatic,
  thinking: thinkingStatic,
  focused: focusedStatic,
  curious: curiousStatic,
  confused: confusedStatic,
  surprised: surprisedStatic,
  doubtful: doubtfulStatic,
  unamused: unamusedStatic,
  strain: strainStatic,
  sad: sadStatic,
  oops: oopsStatic,
  dizzy: dizzyStatic,
  sleepy: sleepyStatic,
  learned: learnedStatic,
  money: moneyStatic,
  "needs-you": needsYouStatic,
};

/** The animated SVG markup of a face. It stops its own animation under `prefers-reduced-motion`. */
export function animatedSvg(id: EmotionId): string {
  return ANIMATED_SVG[id];
}

/** The SVG markup of a face with no animation, for Reduce Motion and still images. */
export function staticSvg(id: EmotionId): string {
  return STATIC_SVG[id];
}

const DURATION_MS = new Map(config.emotions.map((emotion) => [emotion.id, emotion.durationMs]));

/** The length of one animation loop of a face, from the kit configuration. */
export function emotionDurationMs(id: EmotionId): number {
  return DURATION_MS.get(id) ?? 0;
}
