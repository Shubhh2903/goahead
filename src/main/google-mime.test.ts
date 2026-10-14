import { sourceText } from "@openbot/i18n/source";
import { describe, expect, it } from "vitest";
import { buildRawMessage } from "./google-mime";

const BASE = {
  to: ["alice@example.com"],
  cc: [],
  subject: "Lunch",
  body: "Yes, 12:30.",
  inReplyTo: null,
  references: null,
};

describe("buildRawMessage", () => {
  it("refuses a header break in an address or the subject", () => {
    const injected = "alice@example.com\r\nBcc: evil@example.com";

    expect(() => buildRawMessage({ ...BASE, to: [injected] })).toThrow(
      sourceText("error.connector.gmailBadAddress", { address: injected }),
    );
    expect(() => buildRawMessage({ ...BASE, subject: "Hi\r\nBcc: evil@example.com" })).toThrow(
      sourceText("error.connector.gmailBadHeader"),
    );

    const source = Buffer.from(buildRawMessage(BASE), "base64url").toString("utf8");
    const [headers] = source.split("\r\n\r\n");
    expect(headers).toBe(
      [
        "To: alice@example.com",
        "Subject: Lunch",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
      ].join("\r\n"),
    );
  });
});
