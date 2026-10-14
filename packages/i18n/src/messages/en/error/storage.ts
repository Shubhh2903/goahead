import { defineMessages } from "../../../message";

export const messages = defineMessages("error.storage", {
  // Storage errors.
  "error.storage.unsupported": "Storage is not supported by this server.",
  "error.storage.agentMissing": "The agent does not exist.",
  "error.storage.upstreamDatabase":
    "OpenBot made this database, not GoAhead. GoAhead cannot open it and did not change it.",
});
