/**
 * One Slack message of the inbox as Slack shows it: names for mentions, emoji, links, formatting,
 * code, and the files it shared. Text from Slack only ever becomes text nodes and attributes; nothing
 * here writes HTML.
 */

import type { MessagingInboxFile } from "@openbot/contracts/ipc";
import { Button, File as FileIcon } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { parseSlackMrkdwn, resolveSlackEmoji, type SlackBlock, type SlackInline } from "./slack-mrkdwn";

export interface SlackMessageContentProps {
  text: string;
  files?: readonly MessagingInboxFile[] | undefined;
  /** Display names by Slack user id. An id that is not here shows as it is. */
  people?: Readonly<Record<string, string>> | undefined;
  /** Channel names by channel id, without `#`. */
  channels?: Readonly<Record<string, string>> | undefined;
  /** Workspace emoji: an https image address, or `alias:<name>`. */
  customEmoji?: Readonly<Record<string, string>> | undefined;
  onOpenLink: (url: string) => void;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function SlackMessageContent(props: SlackMessageContentProps): JSX.Element {
  const blocks = createMemo(() => parseSlackMrkdwn(props.text));
  return (
    <div class="slack-message">
      <For each={blocks()}>{(block) => <SlackBlockView {...props} block={block} />}</For>
      <Show when={(props.files?.length ?? 0) > 0}>
        <div class="slack-message-files">
          <For each={props.files ?? []}>{(file) => <SlackFile file={file} onOpenLink={props.onOpenLink} />}</For>
        </div>
      </Show>
    </div>
  );
}

function SlackBlockView(props: SlackMessageContentProps & { block: SlackBlock }): JSX.Element {
  const block = untrack(() => props.block);
  switch (block.type) {
    case "code":
      return (
        <pre class="slack-message-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote class="slack-message-quote">
          <SlackInlineText {...props} pieces={block.inline} />
        </blockquote>
      );
    case "paragraph":
      return (
        <p class="slack-message-line">
          <SlackInlineText {...props} pieces={block.inline} />
        </p>
      );
  }
}

function SlackInlineText(props: SlackMessageContentProps & { pieces: SlackInline[] }): JSX.Element {
  return <For each={props.pieces}>{(piece) => <SlackPiece {...props} piece={piece} />}</For>;
}

function SlackPiece(props: SlackMessageContentProps & { piece: SlackInline }): JSX.Element {
  const piece = untrack(() => props.piece);
  switch (piece.type) {
    case "text":
      return piece.text;
    case "bold":
      return (
        <strong>
          <SlackInlineText {...props} pieces={piece.children} />
        </strong>
      );
    case "italic":
      return (
        <em>
          <SlackInlineText {...props} pieces={piece.children} />
        </em>
      );
    case "strike":
      return (
        <s>
          <SlackInlineText {...props} pieces={piece.children} />
        </s>
      );
    case "code":
      return <code class="slack-message-inline-code">{piece.text}</code>;
    case "link":
      return (
        <a
          class="slack-message-link"
          href={piece.url}
          title={piece.url}
          onClick={(event) => {
            event.preventDefault();
            props.onOpenLink(piece.url);
          }}
        >
          {piece.label}
        </a>
      );
    case "user":
      return <span class="slack-message-mention">@{props.people?.[piece.id] ?? piece.label ?? piece.id}</span>;
    case "channel":
      return <span class="slack-message-mention">#{props.channels?.[piece.id] ?? piece.label ?? piece.id}</span>;
    case "special":
      return <span class="slack-message-mention">{piece.label}</span>;
    case "emoji":
      return <SlackEmoji name={piece.name} customEmoji={props.customEmoji} />;
  }
}

function SlackEmoji(props: { name: string; customEmoji: SlackMessageContentProps["customEmoji"] }): JSX.Element {
  const resolved = createMemo(() => resolveSlackEmoji(props.name, props.customEmoji));
  const unicode = () => {
    const value = resolved();
    return value?.kind === "unicode" ? value.value : null;
  };
  const image = () => {
    const value = resolved();
    return value?.kind === "image" ? value.url : null;
  };
  return (
    <Switch fallback={`:${props.name}:`}>
      <Match when={unicode()}>
        {(value) => (
          <span class="slack-message-emoji" role="img" aria-label={props.name} title={`:${props.name}:`}>
            {value()}
          </span>
        )}
      </Match>
      <Match when={image()}>
        {(url) => (
          <img
            class="slack-message-emoji-image"
            src={url()}
            alt={`:${props.name}:`}
            title={`:${props.name}:`}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            draggable={false}
          />
        )}
      </Match>
    </Switch>
  );
}

/** An image shows inline; another file is a chip with its name and size. Both open the file in Slack. */
function SlackFile(props: { file: MessagingInboxFile; onOpenLink: (url: string) => void }): JSX.Element {
  const { t, format } = useText();
  const image = () => (IMAGE_TYPES.has(props.file.mimeType) ? props.file.previewUrl : null);
  const open = () => {
    if (props.file.permalink) props.onOpenLink(props.file.permalink);
  };
  return (
    <Show
      when={image()}
      fallback={
        <Button
          variant="outline"
          class="slack-message-file"
          disabled={!props.file.permalink}
          aria-label={t("messaging.inbox.file.open", { name: props.file.name })}
          onClick={open}
        >
          <FileIcon aria-hidden="true" />
          <span class="slack-message-file-name">{props.file.name}</span>
          <small>{format.fileSize(props.file.size)}</small>
        </Button>
      }
    >
      {(src) => (
        <Button
          variant="ghost"
          class="slack-message-image"
          disabled={!props.file.permalink}
          title={t("messaging.inbox.file.open", { name: props.file.name })}
          onClick={open}
        >
          <img src={src()} alt={props.file.name} loading="lazy" decoding="async" draggable={false} />
        </Button>
      )}
    </Show>
  );
}
