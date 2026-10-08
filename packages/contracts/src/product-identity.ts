/**
 * The identity of this GoAhead build: its names, its link scheme, and the servers it uses. Every
 * package reads these values from here, so a build never points at another product's servers.
 *
 * Wire protocol names (such as the `OpenBot-Protocol-Version` header and the `openbot-team-v1`
 * WebSocket protocol) are not part of the identity and stay as they are.
 */
export const PRODUCT_IDENTITY = {
  /** The name people see: menus, the Dock, dialogs and notifications. */
  name: "GoAhead",
  /** The macOS bundle id and the Windows AppUserModelId. */
  appId: "com.multicodegenius.goahead",
  /** The custom link scheme, such as `goahead://join/...`. */
  linkScheme: "goahead",
  /** The website: invitation, plugin and agent template links. */
  siteOrigin: "https://goahead.multicodegenius.com",
  /** The account service (Cloudflare Worker). */
  controlPlaneOrigin: "https://goahead-api.multicodegenius.com",
  /** Signal: the relay for remote sessions and the Slack events of the Slack app. */
  signalOrigin: "https://goahead-signal.multicodegenius.com",
  /**
   * The release page. The updater reads the same repository (`publish` in electron-builder.yml). While
   * the repository is private the updater cannot read it, so Settings offers this page instead.
   */
  releasesUrl: "https://github.com/Shubhh2903/goahead/releases/latest",
  /**
   * Product analytics. Off in this build: the OpenPanel project in the code belongs to another
   * product, so nothing is sent. Turn it on only with an analytics service of our own.
   */
  analytics: false,
} as const;

/** The link scheme with its separator, such as `goahead://`. */
export const PRODUCT_LINK_PREFIX = `${PRODUCT_IDENTITY.linkScheme}://`;

/** The link scheme as `URL.protocol` reports it, such as `goahead:`. */
export const PRODUCT_LINK_PROTOCOL = `${PRODUCT_IDENTITY.linkScheme}:`;
