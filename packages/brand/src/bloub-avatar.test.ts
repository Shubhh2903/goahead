import { describe, expect, it } from "vitest";
import { avatarCandidateSeeds, bloubAvatarProfile } from "./bloub-avatar";

// Shapes that bloub 0.4.1 (GoAhead v0.39) drew for these seeds. A bloub update must not change them:
// an agent keeps only its seed, so a changed shape is a changed agent, on this client and on others.
const SHAPES_BEFORE_BLOUB_0_7 = {
  "first-bot": "squircle",
  "crew-sleeper": "nuage",
  "story-avatar": "triangle",
  "agent-1:avatar:0:3": "hexagone",
  "4f1c2b9e-7d1a-4c55-9a7e-2b3c4d5e6f70": "capsule",
  g: "galet",
} as const;

describe("bloubAvatarProfile", () => {
  it("keeps the shape of each existing seed", () => {
    for (const [seed, shape] of Object.entries(SHAPES_BEFORE_BLOUB_0_7)) {
      expect(bloubAvatarProfile(seed, null).shape).toBe(shape);
    }
  });

  it("offers the ghost, jellyfish and octopus with a lookalike for older clients", () => {
    const seeds = avatarCandidateSeeds("agent-1", "agent-1", 0);
    const shapes = seeds.map((seed) => bloubAvatarProfile(seed, null).shape);
    expect(shapes).toEqual(expect.arrayContaining(["fantome", "meduse", "poulpe"]));
    // bloub 0.4.1 draws these seeds as squircle, galet and nuage: the lookalikes.
    expect(seeds).toEqual(
      expect.arrayContaining([
        "agent-1:avatar:0:fantome:face:5",
        "agent-1:avatar:0:meduse:face:3",
        "agent-1:avatar:0:poulpe:face:6",
      ]),
    );
  });
});
