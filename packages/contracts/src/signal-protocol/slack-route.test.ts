import { describe, expect, it } from "vitest";
import { isDefaultSlackRoute, slackOwnerBlockId, slackOwnerFromBlockId } from "./slack-route";

describe("slack route", () => {
  it("reads a ticket entry without isDefault as the default", () => {
    expect(isDefaultSlackRoute({ id: "T1", appId: "A1", linkedAt: 1 })).toBe(true);
    expect(isDefaultSlackRoute({ id: "T1", appId: "A1", linkedAt: 1, isDefault: false })).toBe(false);
  });
  it("round-trips the owner block id and refuses anything else", () => {
    expect(slackOwnerFromBlockId(slackOwnerBlockId("U123ABC"))).toBe("U123ABC");
    expect(slackOwnerFromBlockId("goahead-owner:not a user")).toBeNull();
    expect(slackOwnerFromBlockId("other")).toBeNull();
    expect(slackOwnerFromBlockId(undefined)).toBeNull();
  });
});
