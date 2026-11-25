const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

// Android notifications come through Firebase Cloud Messaging, which needs the Firebase file of the
// app. The file is optional, so the app builds before the Firebase project exists, and such a build
// gets no notifications on Android. The file has public identifiers only; the account service has the
// key that sends. An EAS build gets the file through the file variable `GOOGLE_SERVICES_JSON`.
const GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) =>
  existsSync(resolve(__dirname, GOOGLE_SERVICES_FILE))
    ? { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES_FILE } }
    : config;
