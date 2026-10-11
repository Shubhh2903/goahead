import { describe, expect, it } from "vitest";
import { createAppleAppSiteAssociationResponse } from "../src/server/apple-app-site-association";

describe("Apple app site association", () => {
  it("associates invitations with both signed apps and shared agents with the mobile app only", async () => {
    const response = createAppleAppSiteAssociationResponse({
      APPLE_DESKTOP_APP_ID: "ZTRDTUL87R.app.openbot.desktop",
      APPLE_MOBILE_APP_ID: "ZTRDTUL87R.run.openbot.mobile",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual({
      applinks: {
        apps: [],
        details: [
          { appID: "ZTRDTUL87R.app.openbot.desktop", paths: ["/join"] },
          { appID: "ZTRDTUL87R.run.openbot.mobile", paths: ["/join", "/agents/*"] },
        ],
      },
    });
  });

  it("lists only the GoAhead phone app when the env has no desktop app ID", async () => {
    const response = createAppleAppSiteAssociationResponse({
      APPLE_MOBILE_APP_ID: "S29HD2MDR4.com.multicodegenius.goahead.mobile",
    });

    await expect(response.json()).resolves.toEqual({
      applinks: {
        apps: [],
        details: [{ appID: "S29HD2MDR4.com.multicodegenius.goahead.mobile", paths: ["/join", "/agents/*"] }],
      },
    });
  });
});
