export const SOCIAL_NETWORK_IDS = ["x", "threads", "linkedin", "reddit", "instagram", "tiktok", "facebook"] as const;

export type SocialNetworkId = (typeof SOCIAL_NETWORK_IDS)[number];

export interface SocialNetwork {
  id: SocialNetworkId;
  name: string;
  handle: string;
  kind: "profile" | "community";
  compose: "text" | "link" | "copy";
}

export const SOCIAL_NETWORKS: Record<SocialNetworkId, SocialNetwork> = {
  x: { id: "x", name: "X", handle: "@OpenBot_", kind: "profile", compose: "text" },
  threads: { id: "threads", name: "Threads", handle: "@goahead.multicodegenius.com", kind: "profile", compose: "text" },
  linkedin: { id: "linkedin", name: "LinkedIn", handle: "GoAhead", kind: "profile", compose: "link" },
  reddit: { id: "reddit", name: "Reddit", handle: "r/OpenBot_", kind: "community", compose: "text" },
  instagram: {
    id: "instagram",
    name: "Instagram",
    handle: "@goahead.multicodegenius.com",
    kind: "profile",
    compose: "copy",
  },
  tiktok: { id: "tiktok", name: "TikTok", handle: "@goahead.multicodegenius.com", kind: "profile", compose: "copy" },
  facebook: { id: "facebook", name: "Facebook", handle: "GoAhead", kind: "profile", compose: "link" },
};
