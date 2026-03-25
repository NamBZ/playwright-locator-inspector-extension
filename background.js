// ============================================
// Playwright Locator Inspector — Background Service Worker
// Handles:
//   1. Alt+L keyboard shortcut (Chrome commands API)
//   2. Extension icon click (chrome.action.onClicked)
// ============================================

// Alt+L shortcut → toggle inspector
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-inspector") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        ensureContentScriptAndToggle(tabs[0].id);
      }
    });
  }
});

// Click extension icon → toggle inspector
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) {
    ensureContentScriptAndToggle(tab.id);
  }
});

/**
 * Ensure content script is injected in the tab, then send toggle.
 * If content script is already loaded, it responds to ping → just toggle.
 * If not loaded (tab was open before extension install), inject first → then toggle.
 */
function ensureContentScriptAndToggle(tabId) {
  // Try to ping the content script
  chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      // Content script not loaded → inject it
      chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] })
        .then(() => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }))
        .then(() => {
          // Small delay to let content script initialize
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: "toggle-inspector" });
          }, 100);
        })
        .catch(err => console.warn("Cannot inject into this page:", err));
    } else {
      // Content script is ready → just toggle
      chrome.tabs.sendMessage(tabId, { action: "toggle-inspector" });
    }
  });
}
