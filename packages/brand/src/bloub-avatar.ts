import { COLOR_BY_ID, type ColorId, EXPRESSIONS, type ExpressionId, type ShapeId } from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc";

/**
 * The shapes that the hash of a seed picks from: the eight shapes of bloub 0.4.1, in its order. Keep
 * this list as it is. A longer list would give most existing agents a different shape, and a client
 * on an older release would draw a different shape for the same agent.
 */
const SEEDED_AVATAR_SILHOUETTES = [
  "cercle",
  "galet",
  "squircle",
  "capsule",
  "triangle",
  "hexagone",
  "nuage",
  "goutte",
] as const satisfies readonly ShapeId[];
type SeededSilhouette = (typeof SEEDED_AVATAR_SILHOUETTES)[number];
type SeededSupportedSilhouette = Exclude<SeededSilhouette, "goutte">;

/**
 * The shapes that a seed names, as `<prefix>:<shape>:face:<n>` (upstream OpenBot #14274): ghost,
 * jellyfish and octopus. Each has a lookalike among the seeded shapes. The picker chooses an `n`
 * whose hash gives that lookalike, so a client on an older release draws a similar shape with the
 * same eyes. bloub 0.7.0 also has `carre`, `losange` and `pentagone`; GoAhead does not offer them.
 */
const NAMED_SILHOUETTE_LOOKALIKES = {
  fantome: "squircle",
  meduse: "galet",
  poulpe: "nuage",
} as const satisfies Partial<Record<ShapeId, SeededSupportedSilhouette>>;
type NamedSilhouette = keyof typeof NAMED_SILHOUETTE_LOOKALIKES;
const NAMED_SILHOUETTES = Object.keys(NAMED_SILHOUETTE_LOOKALIKES).filter(isNamedSilhouette);
const NAMED_SILHOUETTE_SEED_PATTERN = /:([a-z]+):face:\d+$/;
const NAMED_SEED_TRIES = 512;

export type SupportedAvatarSilhouetteId = SeededSupportedSilhouette | NamedSilhouette;

export interface BloubAvatarProfile {
  shape: SupportedAvatarSilhouetteId;
  color: ColorId;
  expression: ExpressionId;
}

const AUTOMATIC_COLORS = ["rouge", "orange", "ambre", "vert", "turquoise", "bleu", "violet", "rose"] as const;
const UNSUPPORTED_AVATAR_SILHOUETTE = "goutte" as const satisfies ShapeId;
const SEEDED_SUPPORTED_SILHOUETTES = SEEDED_AVATAR_SILHOUETTES.filter(
  (silhouette): silhouette is SeededSupportedSilhouette => silhouette !== UNSUPPORTED_AVATAR_SILHOUETTE,
);

function isNamedSilhouette(silhouette: string): silhouette is NamedSilhouette {
  return Object.hasOwn(NAMED_SILHOUETTE_LOOKALIKES, silhouette);
}

function namedSilhouette(seed: string): NamedSilhouette | null {
  const silhouette = NAMED_SILHOUETTE_SEED_PATTERN.exec(seed)?.[1];
  return silhouette !== undefined && isNamedSilhouette(silhouette) ? silhouette : null;
}

function seededSilhouette(seed: string): SeededSupportedSilhouette {
  const silhouette = requiredItem(
    SEEDED_AVATAR_SILHOUETTES,
    stableIndex(`${seed}:shape`, SEEDED_AVATAR_SILHOUETTES.length),
  );
  return silhouette === UNSUPPORTED_AVATAR_SILHOUETTE
    ? requiredItem(
        SEEDED_SUPPORTED_SILHOUETTES,
        stableIndex(`${seed}:shape:replacement`, SEEDED_SUPPORTED_SILHOUETTES.length),
      )
    : silhouette;
}

/** A seed that draws the named shape here, and its lookalike on an older client. */
function namedSilhouetteSeed(prefix: string, silhouette: NamedSilhouette): string | null {
  for (let index = 0; index < NAMED_SEED_TRIES; index += 1) {
    const candidate = `${prefix}:${silhouette}:face:${index}`;
    if (seededSilhouette(candidate) === NAMED_SILHOUETTE_LOOKALIKES[silhouette]) return candidate;
  }
  return null;
}

const HUE_COLORS: Readonly<Record<AvatarHue, ColorId>> = {
  0: "rouge",
  30: "orange",
  55: "ambre",
  100: "vert",
  150: "vert",
  185: "turquoise",
  215: "bleu",
  245: "violet",
  280: "violet",
  320: "rose",
};

export const AVATAR_HUE_OPTIONS: ReadonlyArray<{
  hue: AvatarHue;
  label: string;
}> = [
  { hue: 0, label: "Red" },
  { hue: 30, label: "Orange" },
  { hue: 55, label: "Yellow" },
  { hue: 100, label: "Lime" },
  { hue: 150, label: "Green" },
  { hue: 185, label: "Cyan" },
  { hue: 215, label: "Blue" },
  { hue: 245, label: "Indigo" },
  { hue: 280, label: "Violet" },
  { hue: 320, label: "Magenta" },
];

// Hues 100 and 280 stay valid for stored agents, but draw the same color as 150 and 245.
export const AVATAR_HUE_CHOICES = AVATAR_HUE_OPTIONS.filter((option) => option.hue !== 100 && option.hue !== 280);

export function bloubAvatarProfile(seed: string, hue: AvatarHue | null): BloubAvatarProfile {
  const silhouette = namedSilhouette(seed) ?? seededSilhouette(seed);
  const expression = requiredItem(EXPRESSIONS, stableIndex(`${seed}:expression`, EXPRESSIONS.length)).id;

  return {
    shape: silhouette,
    expression,
    color:
      hue === null
        ? requiredItem(AUTOMATIC_COLORS, stableIndex(`${seed}:color`, AUTOMATIC_COLORS.length))
        : HUE_COLORS[hue],
  };
}

export function avatarHueSwatch(hue: AvatarHue): string {
  return colorHex(HUE_COLORS[hue]);
}

export function avatarHeadColor(seed: string, hue: AvatarHue | null): string {
  return colorHex(bloubAvatarProfile(seed, hue).color);
}

export function avatarCandidateSeeds(agentId: string, currentSeed: string, batch: number): string[] {
  const candidates = [currentSeed];
  const firstProfile = bloubAvatarProfile(currentSeed, null);
  const unseenSilhouetteIds = new Set<SupportedAvatarSilhouetteId>(SEEDED_SUPPORTED_SILHOUETTES);
  const usedExpressions = new Set<ExpressionId>([firstProfile.expression]);
  unseenSilhouetteIds.delete(firstProfile.shape);
  let index = 1;

  while (unseenSilhouetteIds.size > 0) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (!unseenSilhouetteIds.delete(profile.shape)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  for (const silhouette of NAMED_SILHOUETTES) {
    if (silhouette === firstProfile.shape) continue;
    const candidate = namedSilhouetteSeed(`${agentId}:avatar:${batch}`, silhouette);
    if (candidate === null || candidates.includes(candidate)) continue;
    candidates.push(candidate);
    usedExpressions.add(bloubAvatarProfile(candidate, null).expression);
  }

  while (candidates.length < 12) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (usedExpressions.has(profile.expression)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  return candidates;
}

function stableIndex(value: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}

function colorHex(color: ColorId): string {
  const value = COLOR_BY_ID.get(color)?.hex;
  if (!value) throw new Error(`Bloub did not return a color for ${color}.`);
  return value;
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("Bloub avatar options are empty.");
  return item;
}
