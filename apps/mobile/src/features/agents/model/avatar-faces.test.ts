import {
  AVATAR_EXPRESSIONS,
  AVATAR_STYLES,
  availableAvatarFace,
  avatarExpressionsForShape,
  avatarSeedForFace,
  avatarStyleForSeed,
  bloubAvatarProfile,
  SUPPORTED_AVATAR_SILHOUETTES,
} from "@openbot/brand/bloub-avatar";
import { describe, expect, it } from "vitest";

// The eight seeded shapes reach only a few expressions each. Every face picker (desktop agent settings,
// first agent setup, phone appearance picker) must offer only faces that a seed draws, or it throws.
describe("avatar face pickers", () => {
  it("draws every offered face, in each style", () => {
    for (const shape of SUPPORTED_AVATAR_SILHOUETTES) {
      const expressions = avatarExpressionsForShape(shape);
      expect(expressions.length).toBeGreaterThan(0);
      for (const expression of expressions) {
        for (const style of AVATAR_STYLES) {
          const seed = avatarSeedForFace("agent-1", { shape, expression }, style);
          expect(bloubAvatarProfile(seed, null)).toMatchObject({ shape, expression });
          expect(avatarStyleForSeed(seed)).toBe(style);
        }
      }
    }
  });

  it("moves a face that no seed draws to one that a seed draws", () => {
    for (const shape of SUPPORTED_AVATAR_SILHOUETTES) {
      for (const expression of AVATAR_EXPRESSIONS) {
        const face = availableAvatarFace({ shape, expression });
        expect(face.shape).toBe(shape);
        expect(() => avatarSeedForFace("agent-1", face)).not.toThrow();
      }
    }
  });
});
