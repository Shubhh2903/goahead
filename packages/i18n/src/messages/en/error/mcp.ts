import { defineMessages } from "../../../message";

export const messages = defineMessages("error.mcp", {
  "error.mcp.redirectByName": "This address is not reachable by name.",
  "error.mcp.redirectNotSignIn": "This address is not part of a sign-in.",
  "error.mcp.redirectRefused": "The sign-in was refused. Go back to GoAhead and try again.",
  "error.mcp.redirectNoSignIn": "This sign-in is no longer active. Go back to GoAhead and start the sign-in again.",
  "error.mcp.redirectSignedIn": "GoAhead is signed in. You can close this window.",
  "error.mcp.redirectNotSaved": "The sign-in did not finish. Go back to GoAhead to see why.",
  "error.mcp.signInFileUnreadable": "The MCP sign-in file is unreadable.",
  "error.mcp.signInFileTooLarge": "The MCP sign-in file is too large.",
  "error.mcp.unsupported": "MCP servers are not supported by this server.",
  "error.mcp.signInOnHost": "Sign-in to an MCP server works only in GoAhead on the host computer.",
  "error.mcp.signInPageOnServer":
    "This sign-in page opens only on the server. Ask an owner or admin of the server to sign in.",
  "error.mcp.signInPageOnServerSwitch":
    "This sign-in page opens only on the server. Switch to this server, then choose Sign in again.",
  "error.mcp.signInAppUnsupported": "This server does not support sign-in apps. Update GoAhead on the host.",
  "error.mcp.redirectRelayed": "GoAhead sent the sign-in to the server. You can close this window.",
  "error.mcp.relayEnded": "This sign-in ended. Start it again.",
  "error.mcp.signInLinkNotReady": "The sign-in page is not open yet. Try again in a moment.",
  "error.mcp.relayNoState":
    "The server's sign-in page does not protect its return address, so GoAhead does not open it on this computer.",
  "error.mcp.relayAddressInvalid":
    "This is not the address at the end of this sign-in. Copy the full address from the browser.",
});
