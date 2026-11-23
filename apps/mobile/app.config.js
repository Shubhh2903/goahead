const { existsSync } = require("node:fs");

/**
 * `app.json` holds the configuration. This adds the Firebase file of the Android app when it exists:
 * a local build reads `./google-services.json`, and an EAS build the file variable
 * `GOOGLE_SERVICES_JSON`. Without it, the app builds without FCM, and only the running app updates
 * the Android live update notification. JavaScript like `metro.config.js`: the app typecheck has no
 * Node types.
 */
module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";
  return existsSync(file) ? { ...config, android: { ...config.android, googleServicesFile: file } } : config;
};
