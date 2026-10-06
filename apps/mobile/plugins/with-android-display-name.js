const { AndroidConfig, withStringsXml } = require("expo/config-plugins");

// The launcher label comes from `app_name`, which Expo sets from `name`. Keep `name`: it also names
// the native projects. Expo adds its own `app_name` mod after this plugin, so that mod runs first
// and this value replaces it.
/** @type {import('expo/config-plugins').ConfigPlugin<{ displayName: string }>} */
module.exports = (config, { displayName }) =>
  withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: "app_name", value: displayName })],
      mod.modResults,
    );
    return mod;
  });
