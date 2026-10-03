// Jukins Background Service Worker
// Manages multi-tab coordination and keeps worker heartbeats alive for background tasks

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Jukins] Extension installed/updated.');
});

// Relay messages between popup and tabs or track tab states
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PING') {
    sendResponse({ status: 'PONG', tabId: sender.tab ? sender.tab.id : null });
    return true;
  }
  
  if (request.type === 'GET_TAB_INFO') {
    sendResponse({
      tabId: sender.tab ? sender.tab.id : null,
      tabUrl: sender.tab ? sender.tab.url : null
    });
    return true;
  }
});
