/**
 * PrefixLinker — Background Service Worker
 *
 * Runs on extension install/update.
 * Sets a default rule the very first time so the extension works
 * out of the box without requiring manual popup configuration.
 */

const DEFAULT_RULES = [
  {
    prefix: 'CSWPR-',
    urlTemplate: 'https://www.google.com/search?q={match}',
  },
];

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return;

  // Only write defaults when there are no existing rules,
  // so a re-install does not overwrite user-customized rules
  // that were synced from another device.
  chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
    if (rules.length === 0) {
      chrome.storage.sync.set({ rules: DEFAULT_RULES });
    }
  });
});
