import type { ExpressionId } from "@norbert_bodziony/bloub";
import {
  type AvatarStyle,
  availableAvatarFace,
  avatarCandidateSeeds,
  avatarExpressionsForShape,
  avatarSeedForFace,
  bloubAvatarProfile,
  SUPPORTED_AVATAR_SILHOUETTES,
  type SupportedAvatarSilhouetteId,
} from "@openbot/brand/bloub-avatar";
import * as Crypto from "expo-crypto";

interface AvatarCandidates {
  namespace: string;
  batch: number;
  seeds: string[];
}

export function createAvatarCandidates(seed: string, previous?: AvatarCandidates): AvatarCandidates {
  const namespace = previous?.namespace ?? seed;
  const batch = previous ? previous.batch + 1 : 0;
  return { namespace, batch, seeds: avatarCandidateSeeds(namespace, seed, batch) };
}

export type AvatarFace = { shape: SupportedAvatarSilhouetteId; expression: ExpressionId };

/** A seed for the face. A face that no seed draws keeps its shape and takes an expression that the shape can draw. */
export function avatarSeedForStyledFace(faceKey: string, wanted: AvatarFace, style: AvatarStyle): string {
  const face = availableAvatarFace(wanted);
  if (style === "plush") {
    const own = bloubAvatarProfile(faceKey, null);
    if (own.shape === face.shape && own.expression === face.expression) return faceKey;
  }
  return avatarSeedForFace(faceKey, face, style);
}

export function randomAvatarFace(current: AvatarFace): AvatarFace {
  const shape = randomOther(SUPPORTED_AVATAR_SILHOUETTES, current.shape);
  return { shape, expression: randomOther(avatarExpressionsForShape(shape), current.expression) };
}

function randomOther<T>(items: readonly T[], current: T): T {
  const others = items.filter((item) => item !== current);
  return others[Math.floor(Math.random() * others.length)] ?? current;
}

export function newAvatarSeed(): string {
  return `mobile:${Crypto.randomUUID().replaceAll("-", "")}`;
}
