let prevProcessedWord = null;
let prevProcessedTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'WORD_DATA') {
    const now = Date.now();
    const isDuplicate = message.word === prevProcessedWord && now - prevProcessedTime < 1000;
    
    if (!isDuplicate) {
      chrome.storage.local.get(['connectionState'], (result) => {
        if (result.connectionState && result.connectionState.isConnected) {
          window.postMessage({
            source: 'chrome-extension',
            type: 'WORD_DATA',
            word: message.word,
            timestamp: message.timestamp || Date.now(),
            extensionId: chrome.runtime.id
          }, window.origin);
        }
      });

      prevProcessedWord = message.word;
      prevProcessedTime = now;
    } else {
      console.log('duplicate WORD_DATA:', message.word);
    }
    
    sendResponse({ success: true });
  }
  return true; 
});