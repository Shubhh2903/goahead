import type { ChatBackdropUploadKind } from "@openbot/contracts/chat-backdrop";
import { Match, onSettled, Switch } from "solid-js";
import { REDUCED_MOTION_QUERY } from "../../utils";

/**
 * A video that plays muted in a loop behind the window. It pauses while the window is hidden, and
 * does not play when the system asks for less motion: then it shows its first frame.
 */
function BackdropVideo(props: { url: string }) {
  let video: HTMLVideoElement | undefined;
  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
  const sync = () => {
    if (!video) return;
    if (reducedMotion.matches || document.hidden) video.pause();
    else void video.play().catch(() => undefined);
  };
  onSettled(() => {
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  });
  return (
    <video
      ref={(element) => {
        video = element;
      }}
      class="chat-backdrop-media"
      src={props.url}
      muted
      loop
      playsinline
      preload="auto"
      disablepictureinpicture
      disableremoteplayback
      tabindex={-1}
      onLoadedData={sync}
    />
  );
}

/** An image or a video that the user uploaded, over the whole window, with a tint that keeps text readable. */
export function CustomBackdrop(props: { kind: ChatBackdropUploadKind; url: string }) {
  return (
    <div class="chat-backdrop chat-backdrop-custom" aria-hidden="true">
      <Switch>
        <Match when={props.kind === "image"}>
          <img class="chat-backdrop-media" src={props.url} alt="" draggable={false} />
        </Match>
        <Match when={props.kind === "video"}>
          <BackdropVideo url={props.url} />
        </Match>
      </Switch>
    </div>
  );
}
