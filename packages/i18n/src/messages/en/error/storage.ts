import { defineMessages } from "../../../message";

export const messages = defineMessages("error.storage", {
  "error.storage.unsupported": "Storage is not supported by this server.",
  "error.storage.agentMissing": "The agent does not exist.",
  "error.storage.folderNotTrashable":
    "This folder cannot be moved to the Trash. Only a folder directly in the Agents folder that no agent in this GoAhead profile uses can go.",
  "error.storage.folderRecentlyChanged":
    "This folder cannot be moved to the Trash. A file in it changed in the last 7 days, so another GoAhead or OpenBot install on this Mac can still use it.",
  "error.storage.upstreamDatabase":
    "OpenBot made this database, not GoAhead. GoAhead cannot open it and did not change it.",
  "error.storage.unreadableFile": "GoAhead cannot read {path}. The file is damaged.",
});
