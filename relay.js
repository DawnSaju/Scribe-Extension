let prevProcessedWord = null;
let prevProcessedTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'WORD_DATA') {
    const now = Date.now();
    const wordText = typeof message.word === 'string' ? message.word : JSON.stringify(message.word);

    const isDuplicate = wordText === prevProcessedWord && (now - prevProcessedTime < 1000);

    if (isDuplicate) {
      console.log('Duplicate WORD_DATA:', wordText);
      sendResponse({ success: false, duplicate: true });
      return false; 
    }

    prevProcessedWord = wordText;
    prevProcessedTime = now;

    chrome.storage.local.get(['connectionState'], (result) => {
      const isConnected = result.connectionState?.isConnected ?? true;
      if (isConnected) {
        window.postMessage({
          source: 'chrome-extension',
          type: 'WORD_DATA',
          word: message.word,
          timestamp: message.timestamp || Date.now(),
          extensionId: chrome.runtime.id
        }, window.origin);
      } else {
        console.warn('Not connected, message not posted');
      }
      sendResponse({ success: true });
    });

    return true;
  }
});
