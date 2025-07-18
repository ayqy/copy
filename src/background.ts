import { getSettings, type Prompt } from './shared/settings-manager';

const PARENT_MENU_ID = 'magic-copy-with-prompt';

async function updateContextMenu() {
  await chrome.contextMenus.removeAll();

  // Create the main "Convert Page" item
  chrome.contextMenus.create({
    id: 'convert-page-to-ai-friendly-format',
    title: chrome.i18n.getMessage('convertPage') || 'Convert Page to AI-Friendly Format',
    contexts: ['page']
  });

  const { userPrompts } = await getSettings();

  if (userPrompts && userPrompts.length > 0) {
    chrome.contextMenus.create({
      id: PARENT_MENU_ID,
      title: 'Magic Copy with Prompt',
      contexts: ['selection']
    });

    userPrompts.forEach((prompt: Prompt) => {
      chrome.contextMenus.create({
        id: prompt.id,
        title: prompt.title,
        parentId: PARENT_MENU_ID,
        contexts: ['selection']
      });
    });
  }
}

let clipboardStack: string[] = [];

// Extension lifecycle events
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('AI Copilot extension installed/updated:', details.reason);
  await updateContextMenu();

  // Initialize settings on first install
  if (details.reason === 'install') {
    console.log('First install - initializing settings...');
    await getSettings(); // This will create default settings
    console.log('Settings initialized successfully');
  }

  // Handle updates
  if (details.reason === 'update') {
    const previousVersion = details.previousVersion;
    console.log(`Updated from version ${previousVersion}`);

    // Ensure settings are compatible with new version
    await getSettings(); // This will merge with defaults if needed
    console.log('Settings migrated successfully');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('AI Copilot extension started');
  await updateContextMenu();
});

// Handle messages from content scripts (for future features)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.debug('Background received message:', message, 'from', sender);

  // Handle different message types
  switch (message.type) {
    case 'copy-to-clipboard':
      {
        const { text, isShiftPressed } = message;
        
        // Forward the message to the content script in the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            let textToSend: string;
            
            if (isShiftPressed) {
              // Append mode: add to clipboard stack and combine with existing content
              clipboardStack.push(text);
              chrome.action.setBadgeText({ text: clipboardStack.length.toString() });
              textToSend = clipboardStack.join('\n\n---\n\n');
            } else {
              // Normal mode: clear the stack and copy just the current text
              clipboardStack = [text];
              chrome.action.setBadgeText({ text: '' });
              textToSend = text;
            }
            
            chrome.tabs.sendMessage(
              tabs[0].id,
              {
                type: 'copy-to-clipboard-from-background',
                text: textToSend
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.warn('Could not send message to content script:', chrome.runtime.lastError.message);
                  sendResponse({ success: true, warning: 'Content script not available.' });
                } else {
                  sendResponse({ 
                    success: response.success, 
                    action: isShiftPressed ? 'appended' : 'copied',
                    error: response.error 
                  });
                }
              }
            );
          } else {
            console.error('No active tab found to send the message to.');
            sendResponse({ success: false, error: 'No active tab found.' });
          }
        });
        return true; // Indicate that the response is asynchronous
      }

    case 'ping':
      sendResponse({ success: true, message: 'pong' });
      break;

    case 'update-context-menu':
      updateContextMenu();
      sendResponse({ success: true });
      break;

    case 'clear-clipboard-stack':
      clipboardStack = [];
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
      break;

    case 'error-report':
      // Future: handle error reporting
      console.error('Error reported from content script:', message.error);
      sendResponse({ success: true });
      break;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Handle storage changes (for debugging)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.copilot_settings && namespace === 'sync') {
    console.debug('Settings updated, rebuilding context menu...');
    updateContextMenu();
  }
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'convert-page-to-ai-friendly-format' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONVERT_PAGE_WITH_SELECTION'  // 使用新的消息类型
    });
    return;
  }

  if (info.parentMenuItemId === PARENT_MENU_ID && info.selectionText && tab && tab.id) {
    const { userPrompts } = await getSettings();
    const prompt = userPrompts.find((p: Prompt) => p.id === info.menuItemId);
    if (prompt) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'PROCESS_SELECTION_WITH_PROMPT',  // 使用新的消息类型
        promptTemplate: prompt.template
      });
    }
  }
});

// Performance monitoring (development only)
if (process.env.NODE_ENV === 'development') {
  // Monitor performance and log any issues
  let performanceBuffer: unknown[] = [];

  setInterval(() => {
    if (performanceBuffer.length > 0) {
      console.debug('Performance metrics:', performanceBuffer);
      performanceBuffer = [];
    }
  }, 30000); // Log every 30 seconds
}

console.log('AI Copilot background script loaded');
