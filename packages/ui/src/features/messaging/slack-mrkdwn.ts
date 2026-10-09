import { SLACK_EMOJI_SHORTCODES, SLACK_SKIN_TONE } from "./slack-emoji-shortcodes";

/** One piece of a line of Slack text. Every text value is already unescaped. */
export type SlackInline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "strike"; children: SlackInline[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string; label: string }
  | { type: "user"; id: string; label: string | null }
  | { type: "channel"; id: string; label: string | null }
  | { type: "special"; label: string }
  | { type: "emoji"; name: string };

/** A run of lines of Slack text. Line ends inside `inline` stay as `\n` in text pieces. */
export type SlackBlock =
  | { type: "paragraph"; inline: SlackInline[] }
  | { type: "quote"; inline: SlackInline[] }
  | { type: "code"; text: string };

const FENCE = "```";
const EMOJI = /^:([a-z0-9_+'-]+):/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/u;
/** A Slack user id as plain text, as older inbox rows keep a mention: `@U083KAUM7TK`. */
const BARE_USER = /^@([UW][A-Z0-9]{6,})(?![A-Za-z0-9])/u;
/** A Slack channel id as plain text: `#C0123ABCD`. */
const BARE_CHANNEL = /^#([CG][A-Z0-9]{6,})(?![A-Za-z0-9])/u;
const MARKERS = { "*": "bold", _: "italic", "~": "strike" } as const;
const WORD = /[\p{L}\p{N}]/u;
const SPECIAL_MENTIONS = new Set(["here", "channel", "everyone"]);

/**
 * Slack `mrkdwn` as blocks and inline pieces, without HTML: the caller builds elements from them, so
 * no text from Slack is ever read as markup. It reads the markup Slack sends (`<@U…>`, `<#C…|name>`,
 * `<https://…|label>`, `&lt;`) and the plain form older inbox rows keep (`@U…`, a bare address).
 */
export function parseSlackMrkdwn(text: string): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const parts = text.split(FENCE);
  // An odd count of fences leaves the last one as text: Slack shows an unclosed fence as typed.
  const closed = parts.length % 2 === 1 ? parts.length : parts.length - 1;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (index % 2 === 1 && index < closed) {
      const code = unescapeSlack(part.replace(/^\n/u, "").replace(/\n$/u, ""));
      blocks.push({ type: "code", text: code });
      continue;
    }
    const source = index % 2 === 1 ? `${FENCE}${part}` : part;
    textBlocks(trimBlockEdges(source, index > 0, index < parts.length - 1), blocks);
  }
  return blocks;
}

/** The text next to a code block loses the line end that only separated it from the fence. */
function trimBlockEdges(text: string, afterFence: boolean, beforeFence: boolean): string {
  let result = text;
  if (afterFence) result = result.replace(/^\n/u, "");
  if (beforeFence) result = result.replace(/\n$/u, "");
  return result;
}

function textBlocks(text: string, blocks: SlackBlock[]): void {
  if (!text) return;
  let run: { quote: boolean; lines: string[] } | null = null;
  const flush = () => {
    if (!run) return;
    const inline = parseInline(run.lines.join("\n"));
    if (inline.length) blocks.push({ type: run.quote ? "quote" : "paragraph", inline });
    run = null;
  };
  for (const line of text.split("\n")) {
    const quote = /^(?:&gt;|>)\s?/u.exec(line);
    const isQuote = quote !== null;
    if (!run || run.quote !== isQuote) {
      flush();
      run = { quote: isQuote, lines: [] };
    }
    run.lines.push(isQuote ? line.slice(quote[0].length) : line);
  }
  flush();
}

/** One line run of Slack text as inline pieces. */
export function parseInline(text: string): SlackInline[] {
  const pieces: SlackInline[] = [];
  let buffer = "";
  const flushText = () => {
    if (buffer) pieces.push({ type: "text", text: unescapeSlack(buffer) });
    buffer = "";
  };
  const push = (piece: SlackInline) => {
    flushText();
    pieces.push(piece);
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    const rest = text.slice(index);
    if (char === "<") {
      const end = text.indexOf(">", index + 1);
      const inner = end > index ? text.slice(index + 1, end) : "";
      const token = end > index && !inner.includes("\n") ? slackToken(inner) : null;
      if (token) {
        push(token);
        index = end + 1;
        continue;
      }
    }
    if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1 && !text.slice(index + 1, end).includes("\n")) {
        push({ type: "code", text: unescapeSlack(text.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    if (char === ":") {
      const emoji = EMOJI.exec(rest);
      if (emoji?.[1]) {
        push({ type: "emoji", name: emoji[1] });
        index += emoji[0].length;
        // `:wave::skin-tone-3:`: the tone is dropped, the emoji stays.
        const tone = EMOJI.exec(text.slice(index));
        if (tone?.[1] && SLACK_SKIN_TONE.test(tone[1])) index += tone[0].length;
        continue;
      }
    }
    if ((char === "h" || char === "H") && !WORD.test(text[index - 1] ?? "")) {
      const url = BARE_URL.exec(rest);
      if (url) {
        const address = trimUrl(url[0]);
        push({ type: "link", url: unescapeSlack(address), label: unescapeSlack(address) });
        index += address.length;
        continue;
      }
    }
    if (char === "@" && !WORD.test(text[index - 1] ?? "")) {
      const user = BARE_USER.exec(rest);
      if (user?.[1]) {
        push({ type: "user", id: user[1], label: null });
        index += user[0].length;
        continue;
      }
    }
    if (char === "#" && !WORD.test(text[index - 1] ?? "")) {
      const channel = BARE_CHANNEL.exec(rest);
      if (channel?.[1]) {
        push({ type: "channel", id: channel[1], label: null });
        index += channel[0].length;
        continue;
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      const end = formattingEnd(text, index);
      if (end !== null) {
        push({ type: MARKERS[char], children: parseInline(text.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flushText();
  return pieces;
}

/**
 * Where a `*bold*`, `_italic_` or `~strike~` that opens at `start` closes, or null. As in Slack, the
 * marker opens only after a space or a sign, and its text neither starts nor ends with a space. A
 * marker inside `<…>` or a code span does not close it, so `_` in an address stays.
 */
function formattingEnd(text: string, start: number): number | null {
  const marker = text[start];
  const before = text[start - 1] ?? "";
  const first = text[start + 1] ?? "";
  if (WORD.test(before) || !first || /\s/u.test(first) || first === marker) return null;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") return null;
    if (char === "<" || char === "`") {
      const close = text.indexOf(char === "<" ? ">" : "`", index + 1);
      if (close > index) {
        index = close;
        continue;
      }
    }
    if (char !== marker || index === start + 1) continue;
    const previous = text[index - 1] ?? "";
    const after = text[index + 1] ?? "";
    if (!/\s/u.test(previous) && !WORD.test(after)) return index;
  }
  return null;
}

/** `<…>` markup, or null when it is not markup Slack sends: then it stays as text. */
function slackToken(inner: string): SlackInline | null {
  const bar = inner.indexOf("|");
  const target = bar >= 0 ? inner.slice(0, bar) : inner;
  const label = bar >= 0 ? unescapeSlack(inner.slice(bar + 1)) : null;
  if (/^@[UWB][A-Z0-9]+$/u.test(target)) return { type: "user", id: target.slice(1), label: label || null };
  if (/^#[CGD][A-Z0-9]+$/u.test(target)) return { type: "channel", id: target.slice(1), label: label || null };
  if (target.startsWith("!")) {
    const name = target.slice(1);
    if (SPECIAL_MENTIONS.has(name)) return { type: "special", label: `@${name}` };
    // `<!subteam^S1|@design>` and `<!date^…|Friday>` carry the text Slack shows.
    if (label) return { type: "special", label };
    return null;
  }
  if (/^https?:\/\//iu.test(target)) {
    const url = unescapeSlack(target);
    return { type: "link", url, label: label || url };
  }
  if (/^mailto:/iu.test(target)) return { type: "text", text: label || unescapeSlack(target.slice("mailto:".length)) };
  return null;
}

/** A bare address ends before the signs that usually close the sentence around it. */
function trimUrl(url: string): string {
  let result = url.replace(/[.,;:!?'"]+$/u, "");
  while (result.endsWith(")") && (result.match(/\(/gu)?.length ?? 0) < (result.match(/\)/gu)?.length ?? 0))
    result = result.slice(0, -1);
  return result;
}

/** Slack escapes only these three. */
export function unescapeSlack(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * What an emoji name shows: a standard emoji as Unicode, a workspace emoji as its image address, or
 * null, when the name stays as `:name:` text. `custom` maps a name to an https address or to
 * `alias:<name>`; an alias is followed a few steps, to a workspace emoji or a standard one.
 */
export function resolveSlackEmoji(
  name: string,
  custom: Readonly<Record<string, string>> | undefined,
): { kind: "unicode"; value: string } | { kind: "image"; url: string } | null {
  let current = name;
  for (let step = 0; step < 4; step += 1) {
    const value = custom && Object.hasOwn(custom, current) ? custom[current] : undefined;
    if (value === undefined) break;
    if (value.startsWith("alias:")) {
      current = value.slice("alias:".length);
      continue;
    }
    return /^https:\/\//u.test(value) ? { kind: "image", url: value } : null;
  }
  const unicode = Object.hasOwn(SLACK_EMOJI_SHORTCODES, current) ? SLACK_EMOJI_SHORTCODES[current] : undefined;
  return unicode ? { kind: "unicode", value: unicode } : null;
}
