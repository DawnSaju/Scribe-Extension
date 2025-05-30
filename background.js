const history = new Map();
let connectionState = {
    isConnected: false,
    permanentDisconnect: false
  };
  
  chrome.storage.local.get(['connectionState'], (result) => {
    if (result.connectionState) {
      connectionState = result.connectionState;
    }
  });
  
  chrome.runtime.onMessageExternal.addListener(
    async (request, sender, sendResponse) => {
      console.log('Received EXTERNAL message:', request, 'from', sender.url);
  
      const isNgrok = sender.url?.includes('.ngrok-free.app');
      const isScribe = sender.url?.startsWith('https://www.scribe-app.xyz/');
      const isLocalhost = sender.url?.startsWith('http://localhost:3001');
      
      if (!isNgrok && !isScribe && !isLocalhost) {
        console.warn('Blocked message from unknown origin:', sender.url);
        return;
      }
  
      switch (request.type) {
        case 'PING':
          sendResponse({
            type: connectionState.permanentDisconnect ? 'DISCONNECTED' : 'PONG',
            permanentDisconnect: connectionState.permanentDisconnect
          });
          break;
  
        case 'CHECK_CONNECTION':
          sendResponse({
            isConnected: connectionState.isConnected,
            permanentDisconnect: connectionState.permanentDisconnect
          });
          break;
  
        case 'DISCONNECT_REQUEST':
          connectionState = {
            isConnected: false,
            permanentDisconnect: request.permanent || false
          };
          await chrome.storage.local.set({ connectionState });
  
          chrome.runtime.sendMessage({
            type: 'CONNECTION_STATE_CHANGE',
            ...connectionState
          });
  
          sendResponse({ success: true });
          break;
  
        case 'CONNECT_REQUEST':
          if (connectionState.permanentDisconnect && !request.force) {
            sendResponse({
              success: false,
              reason: 'permanent_disconnect',
              permanentDisconnect: true
            });
          } else {
            connectionState = {
              isConnected: true,
              permanentDisconnect: false
            };
            await chrome.storage.local.set({ connectionState });
            sendResponse({ success: true });
          }
          break;
  
        case 'RESET_CONNECTION':
          connectionState.permanentDisconnect = false;
          await chrome.storage.local.set({ connectionState });
          sendResponse({ success: true });
          break;
  
        case 'SEND_DATA':
          console.log('Triggered SEND_DATA:', request.data);
          break;
          
        case 'TRANSLATION_DATA':
          console.log("TRANSLATION_DATA:", request.data)
          break;
  
        default:
          console.warn('Unknown EXTERNAL message type:', request.type);
      }
  
      return true;
    }
  );
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Got INTERNAL message:', request, sender);

    switch (request.type) {
        case 'SEND_DATA':
          console.log('Got SEND_DATA:', request.data);
              
          (async () => {
            try {
              const tabs = await chrome.tabs.query({
                url: [
                  'https://*.ngrok-free.app/dashboard*',
                  'https://www.scribe-app.xyz/dashboard',
                  'http://localhost:3001/dashboard'
                ]
              });

              console.log('Matching tabs found:', tabs.map(tab => tab.url));

              const scribeTab = tabs.find(tab => tab.url && tab.url.startsWith("https://www.scribe-app.xyz"));
              const targetTab = scribeTab || tabs[0];

              if (!targetTab || !targetTab.id) {
                console.warn('No tabs found to send data.');
                sendResponse({ success: true, warning: 'No matching tabs' });
                return;
              }

              console.log('Sending WORD_DATA to tab ID:', targetTab.id);

              try {
                const response = await chrome.tabs.sendMessage(targetTab.id, {
                  type: 'WORD_DATA',
                  word: request.data,
                  timestamp: Date.now()
                });
                console.log('Sent WORD_DATA successfully:', response);
                sendResponse({ success: true });
              } catch (error) {
                console.error('Error sending data:', error.message);
                sendResponse({ success: false, error: error.message });
              }
            } catch (error) {
              console.error('Error in the hook SEND_DATA:', error);
              sendResponse({ success: false, error: error.message });
            }
          })();

          return true;

        default:
        console.warn('Unknown INTERNAL request type:', request.type);
        sendResponse({ success: false, error: 'Unknown type' });
        return false;
    }
    });