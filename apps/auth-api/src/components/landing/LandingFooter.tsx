import { AppLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { EXTERNAL_LINK_REL, FOOTER_COLUMNS, type FooterLink, OPENBOT_LINKS } from "../../lib/landing-links";
import { localizedPath } from "../../lib/site-paths";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";
import { useSiteChrome, useSitePath } from "./SiteText";

const GITHUB_MARK_PATH =
  "M12 .7C5.7.7.8 5.6.8 11.9c0 5 3.2 9.3 7.6 10.8.6.1.8-.3.8-.6v-2.2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.5-.3-5.1-1.2-5.1-5.6 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.7 6 18.8 6.3 18.8 6.3c.6 1.5.2 2.7.1 3 .8.8 1.2 1.8 1.2 3 0 4.4-2.6 5.3-5.1 5.6.4.4.8 1.1.8 2.1v3.2c0 .3.2.7.8.6a11.2 11.2 0 0 0 7.6-10.8C23.2 5.6 18.3.7 12 .7Z";

const X_MARK_PATH =
  "M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.1 3h6.5l4.5 6 5.4-6Zm-1.1 16h1.8L7.6 4.9H5.7L16.4 19Z";

interface FooterSocial {
  label: string;
  href: string;
  Mark: () => JSX.Element;
}

function pathMark(path: string) {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const SOCIALS: readonly FooterSocial[] = [
  { label: "GitHub", href: OPENBOT_LINKS.repository, Mark: pathMark(GITHUB_MARK_PATH) },
  { label: "X", href: OPENBOT_LINKS.x, Mark: pathMark(X_MARK_PATH) },
];

export function LandingFooter() {
  let footerRef: HTMLElement | undefined;
  const chrome = useSiteChrome();
  const text = () => chrome().text.footer;
  const revealed = createLandingReveal(() => footerRef);

  const revealState = () => (revealed() ? "true" : "false");

  return (
    <footer ref={footerRef} class="landing-footer" data-slot="landing-footer" lang={chrome().lang}>
      <div class="landing-footer-inner">
        <div class="landing-footer-grid">
          <div class="landing-footer-brand" data-revealed={revealState()}>
            <Link
              class="landing-footer-lockup"
              to={localizedPath("/", chrome().locale)}
              aria-label={chrome().text.home}
            >
              <AppLogo variant="production" class="landing-footer-logo" />
              <span>GoAhead</span>
            </Link>

            <p class="landing-footer-description">{text().description}</p>

            <Link class="landing-footer-cta" to="/download">
              <span>{text().download}</span>
              <LandingIcon name="download" />
            </Link>

            <div class="landing-footer-socials">
              <For each={SOCIALS}>
                {(social) => (
                  <a
                    class="landing-footer-social"
                    href={social.href}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    aria-label={social.label}
                  >
                    <span class="landing-visually-hidden">{social.label}</span>
                    <social.Mark />
                  </a>
                )}
              </For>
            </div>
          </div>

          <nav class="landing-footer-columns" aria-label={text().navigation} data-revealed={revealState()}>
            <For each={FOOTER_COLUMNS}>
              {(column) => (
                <div class="landing-footer-column">
                  <h2>{text().columns[column.id]}</h2>
                  <ul>
                    <For each={column.links}>
                      {(link) => (
                        <li>
                          <FooterNavLink link={link} />
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </nav>
        </div>

        <div class="landing-footer-bottom" data-revealed={revealState()}>
          <p>{text().rights}</p>
          <div class="landing-footer-meta">
            <Link to="/download">
              <span class="landing-footer-availability" aria-hidden="true" />
              {text().available}
            </Link>
            <p class="landing-footer-made">
              {text().made.before}
              <LandingIcon name="heart" label={text().love} />
              {text().made.after}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterNavLink(props: { link: FooterLink }) {
  const chrome = useSiteChrome();
  const path = useSitePath();
  const label = () => {
    const name = props.link.label;
    return typeof name === "string" ? name : chrome().text.footer.links[name.text];
  };
  const external = () => (props.link.external ? props.link : undefined);
  const page = () => (props.link.external || "slug" in props.link ? undefined : props.link);
  const article = () => (!props.link.external && "slug" in props.link ? props.link : undefined);

  return (
    <>
      <Show when={external()}>
        {(link) => (
          <a href={link().href} target="_blank" rel={EXTERNAL_LINK_REL}>
            {label()}
          </a>
        )}
      </Show>
      <Show when={page()}>
        {(link) => (
          <Show when={link().hash} fallback={<Link to={path(link().to)}>{label()}</Link>}>
            {(hash) => (
              <Link to={path(link().to)} hash={hash()}>
                {label()}
              </Link>
            )}
          </Show>
        )}
      </Show>
      <Show when={article()}>
        {(link) => (
          <Link to={link().to} params={{ slug: link().slug }}>
            {label()}
          </Link>
        )}
      </Show>
    </>
  );
}
