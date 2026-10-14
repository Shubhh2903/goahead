import { PlatformLogo, type PlatformLogoVariant } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { DOWNLOAD_PLATFORM_ORDER, DOWNLOAD_PLATFORMS } from "../../lib/download-platforms";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

interface DownloadCardContentProps {
  action?: string;
  description: string;
  platform: PlatformLogoVariant;
  status: string;
  title: string;
}

function DownloadCardContent(props: DownloadCardContentProps) {
  return (
    <>
      <div class="landing-download-card-top">
        <PlatformLogo platform={props.platform} class="landing-download-platform-logo" />
        <span class="landing-download-status">{props.status}</span>
      </div>
      <div class="landing-download-card-copy">
        <h3>{props.title}</h3>
        <p>{props.description}</p>
        <Show when={props.action}>
          <span class="landing-download-action">
            {props.action}
            <LandingIcon name="arrow-up-right" class="landing-download-arrow" />
          </span>
        </Show>
      </div>
    </>
  );
}

export function DownloadSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const revealState = () => (revealed() ? "true" : "false");

  return (
    <section ref={sectionRef} id="download" class="landing-download" aria-labelledby="download-title">
      <div class="landing-download-inner">
        <header class="landing-download-heading" data-revealed={revealState()}>
          <h2 id="download-title">Download GoAhead</h2>
          <p>
            For a Mac with Apple silicon. Run Codex, Claude, Gemini, Grok, OpenCode or your own model from one desktop
            app.
          </p>
        </header>

        <div class="landing-download-grid">
          <For each={DOWNLOAD_PLATFORM_ORDER}>
            {(platform) => {
              const details = DOWNLOAD_PLATFORMS[platform];
              const content = () => (
                <DownloadCardContent
                  platform={platform}
                  status={details.status}
                  title={details.label}
                  description={details.description}
                  action={details.href ? details.action : undefined}
                />
              );
              // A system with no installer yet is a card with no link, so it offers nothing to download.
              return (
                <Show
                  when={details.available && details.href}
                  fallback={
                    <div
                      class="landing-download-card"
                      data-download-platform={platform}
                      data-state="coming-soon"
                      data-revealed={revealState()}
                    >
                      {content()}
                    </div>
                  }
                >
                  {(href) => (
                    <a
                      class="landing-download-card"
                      href={href()}
                      data-download-platform={platform}
                      data-state="available"
                      data-revealed={revealState()}
                    >
                      {content()}
                    </a>
                  )}
                </Show>
              );
            }}
          </For>
        </div>

        {/* The cards start the download, so the pages that explain each installer get their own
            links. They are also how a crawler finds those pages from the home page. */}
        <p class="landing-download-pages">
          System requirements and install steps:
          <For each={DOWNLOAD_PLATFORM_ORDER}>
            {(platform) => (
              <Link to="/download/$platform" params={{ platform }}>
                {DOWNLOAD_PLATFORMS[platform].label}
              </Link>
            )}
          </For>
        </p>
      </div>
    </section>
  );
}
