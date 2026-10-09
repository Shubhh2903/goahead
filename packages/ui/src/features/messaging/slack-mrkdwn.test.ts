import { describe, expect, it } from "vitest";
import { parseInline, parseSlackMrkdwn, resolveSlackEmoji } from "./slack-mrkdwn";

describe("parseSlackMrkdwn", () => {
  it("reads mentions, channel links and special mentions in both Slack and plain form", () => {
    expect(parseInline("Hi <@U083KAUM7TK> and @U0ABCDEFG in <#C111AAA|general> and #C222BBBBB, <!here>")).toEqual([
      { type: "text", text: "Hi " },
      { type: "user", id: "U083KAUM7TK", label: null },
      { type: "text", text: " and " },
      { type: "user", id: "U0ABCDEFG", label: null },
      { type: "text", text: " in " },
      { type: "channel", id: "C111AAA", label: "general" },
      { type: "text", text: " and " },
      { type: "channel", id: "C222BBBBB", label: null },
      { type: "text", text: ", " },
      { type: "special", label: "@here" },
    ]);
  });

  it("reads labelled and bare links, and keeps the sign that ends the sentence out", () => {
    expect(parseInline("See <https://example.com/a?b=1&amp;c=2|the docs> or https://x.dev/path.")).toEqual([
      { type: "text", text: "See " },
      { type: "link", url: "https://example.com/a?b=1&c=2", label: "the docs" },
      { type: "text", text: " or " },
      { type: "link", url: "https://x.dev/path", label: "https://x.dev/path" },
      { type: "text", text: "." },
    ]);
  });

  it("reads bold, italic, strike and code, and leaves snake_case and markup in an address alone", () => {
    expect(parseInline("*big _news_* ~old~ `a < b` snake_case_name <https://a.dev/x_y_z|x_y>")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "big " },
          { type: "italic", children: [{ type: "text", text: "news" }] },
        ],
      },
      { type: "text", text: " " },
      { type: "strike", children: [{ type: "text", text: "old" }] },
      { type: "text", text: " " },
      { type: "code", text: "a < b" },
      { type: "text", text: " snake_case_name " },
      { type: "link", url: "https://a.dev/x_y_z", label: "x_y" },
    ]);
  });

  it("reads emoji, drops a skin tone, and keeps a time of day as text", () => {
    expect(parseInline(":clap::skin-tone-2::sparkles: at 10:30")).toEqual([
      { type: "emoji", name: "clap" },
      { type: "emoji", name: "sparkles" },
      { type: "text", text: " at 10:30" },
    ]);
  });

  it("unescapes text, keeps an escaped tag as text, and splits code blocks and quotes", () => {
    expect(parseSlackMrkdwn("&lt;b&gt; &amp; <b>\n&gt; quoted *line*\n```\nconst a = 1 &lt; 2;\n```\nafter")).toEqual([
      { type: "paragraph", inline: [{ type: "text", text: "<b> & <b>" }] },
      {
        type: "quote",
        inline: [
          { type: "text", text: "quoted " },
          { type: "bold", children: [{ type: "text", text: "line" }] },
        ],
      },
      { type: "code", text: "const a = 1 < 2;" },
      { type: "paragraph", inline: [{ type: "text", text: "after" }] },
    ]);
  });
});

describe("resolveSlackEmoji", () => {
  const custom = {
    "clapclap-e": "https://emoji.slack-edge.com/T1/clapclap-e/abc.gif",
    party: "alias:clapclap-e",
    yay: "alias:tada",
    broken: "javascript:alert(1)",
  };

  it("gives Unicode for a standard name, an image for a workspace emoji and its alias, and null otherwise", () => {
    expect(resolveSlackEmoji("tada", custom)).toEqual({ kind: "unicode", value: "🎉" });
    expect(resolveSlackEmoji("clapclap-e", custom)).toEqual({ kind: "image", url: custom["clapclap-e"] });
    expect(resolveSlackEmoji("party", custom)).toEqual({ kind: "image", url: custom["clapclap-e"] });
    expect(resolveSlackEmoji("yay", custom)).toEqual({ kind: "unicode", value: "🎉" });
    expect(resolveSlackEmoji("broken", custom)).toBeNull();
    expect(resolveSlackEmoji("30", custom)).toBeNull();
  });
});
