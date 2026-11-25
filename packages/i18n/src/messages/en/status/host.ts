import { defineMessages } from "../../../message";

export const messages = defineMessages("status.host", {
  "status.host.registered": "Registered this GoAhead for WebRTC access.",
  "status.host.keyRotated": "Server key changed. Paired devices stay paired.",
  "status.host.identityUpdated": "Server identity updated.",
  "status.host.starting": "Starting the WebRTC host…",
  "status.host.ready": "This GoAhead is ready for WebRTC connections.",
  "status.host.signalLost": "Other devices cannot reach this GoAhead now. It connects again.",
  "status.host.stopping": "Making this GoAhead private…",
  "status.host.private": "This GoAhead is private.",
  "status.host.removed": "This GoAhead was removed from your account. Publish it again to share it.",
});
