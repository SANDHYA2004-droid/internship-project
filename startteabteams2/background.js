










let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for tab updates to detect Teams pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isTeamsTab(tab.url)) {
    console.log("✅ Teams tab detected:", tabId, tab.url);
    
    // Check if user has given permission for auto recording
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      if (result.autoRecordPermission) {
        console.log("🎬 Auto recording enabled - Waiting for Join button click...");
        
        // Wait for content script to initialize
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: "checkMeetingStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              console.log("⚠️ Content script not ready yet, will detect meeting when Join button is clicked");
              return;
            }
            
            if (response && response.isInMeeting && !response.recording) {
              console.log("✅ Meeting already in progress - starting auto recording");
              startRecordingForTab(tabId);
            }
          });
        }, 3000);
      }
    });
  }
});

function isTeamsTab(url) {
  return url && (url.includes("teams.microsoft.com") || url.includes("teams.live.com"));
}

// Handle permission messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    console.log("✅ User granted auto recording permission");
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => {
      // Notify all Teams tabs about permission change
      chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRecordPermission",
            enabled: true
          });
        });
      });
    });
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    console.log("❌ User revoked auto recording permission");
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => {
      // Notify all Teams tabs about permission change
      chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRecordPermission",
            enabled: false
          });
        });
      });
    });
    sendResponse({ success: true });
  }
  
  if (message.action === "getAutoRecordPermission") {
    sendResponse({ permission: userPermissionGranted });
  }

  if (message.action === "autoStartRecording") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`🎬 Auto starting recording - Join button clicked (+3s delay completed) at ${timestamp}`);
    console.log("📍 Source tab:", sender.tab.id, sender.tab.url);
    
    // Start recording immediately
    startRecordingForTab(sender.tab.id);
    
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`🛑 Auto stopping recording - Leave button clicked (Meeting ended) at ${timestamp}`);
    console.log("📍 Source tab:", sender.tab.id);
    stopAllRecordings();
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("❌ Cannot check meeting status:", chrome.runtime.lastError);
        sendResponse({ error: "Content script not ready" });
        return;
      }
      sendResponse(response);
    });
    return true;
  }

  if (message.action === "recordingStarted") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`✅ Recording started successfully at ${timestamp}`);
    console.log("📊 Recording tab:", sender.tab.id);
    currentRecordingTab = sender.tab.id;
    
    // Update storage
    chrome.storage.local.set({ 
      isRecording: true,
      recordingStartTime: Date.now(),
      recordingTabId: sender.tab.id
    });
    
    sendResponse({ success: true });
  }

  if (message.action === "recordingStopped") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`✅ Recording stopped successfully at ${timestamp}`);
    console.log("📊 Was recording tab:", sender.tab.id);
    currentRecordingTab = null;
    
    // Update storage
    chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
    
    sendResponse({ success: true });
  }

  if (message.action === "timerUpdate") {
    // Update recording time in storage
    chrome.storage.local.set({ recordingTime: message.time });
    
    // Forward timer update to all Teams tabs for the popup
    chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: "updateRecordingTimer",
          time: message.time
        });
      });
    });
    
    sendResponse({ success: true });
  }

  if (message.action === "updateRecordingTimer") {
    // Forward timer update to all Teams tabs for the popup
    chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: "updateRecordingTimer",
          time: message.time
        });
      });
    });
    sendResponse({ success: true });
  }

  if (message.action === "showRecordingPopup") {
    // Show popup in all Teams tabs
    chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: "showRecordingPopup"
        });
      });
    });
    sendResponse({ success: true });
  }

  if (message.action === "hideRecordingPopup") {
    // Hide popup in all Teams tabs
    chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: "hideRecordingPopup"
        });
      });
    });
    sendResponse({ success: true });
  }
  
  return true;
});

function startRecordingForTab(tabId) {
  // Check if already recording in ANY tab (not just currentRecordingTab)
  chrome.storage.local.get(['isRecording'], (result) => {
    if (result.isRecording) {
      console.log("⚠️ Already recording in another tab, ignoring auto-record request");
      return;
    }

    console.log("🎬 Starting AUTO recording for Teams tab:", tabId);
    
    // Show recording popup in Teams tab
    chrome.tabs.sendMessage(tabId, {
      action: "showRecordingPopup"
    });
    
    // Create a new tab for recording
    chrome.tabs.create({
      url: chrome.runtime.getURL("recorder.html"),
      active: false
    }, (recorderTab) => {
      console.log("✅ Recorder tab opened for auto recording:", recorderTab.id);
      
      const startRecording = (retryCount = 0) => {
        chrome.tabs.sendMessage(recorderTab.id, { 
          action: "startRecording", 
          tabId: tabId,
          autoRecord: true  // This flag is important
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`❌ Recorder tab not ready (attempt ${retryCount + 1}/3), retrying...`);
            if (retryCount < 2) {
              setTimeout(() => startRecording(retryCount + 1), 1000);
            } else {
              console.error("❌ Failed to start auto recording after 3 attempts");
              chrome.tabs.remove(recorderTab.id);
              chrome.tabs.sendMessage(tabId, { action: "hideRecordingPopup" });
              
              // Send failure response back to content script
              chrome.tabs.sendMessage(tabId, {
                action: "autoRecordingFailed"
              });
            }
          } else {
            console.log("✅ Auto recording started successfully");
            currentRecordingTab = tabId;
          }
        });
      };
      
      // Give recorder tab more time to load
      setTimeout(() => startRecording(), 2000);
    });
  });
}

function stopAllRecordings() {
  console.log("🛑 Stopping all recordings");
  
  // Hide recording popup in all Teams tabs
  chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "hideRecordingPopup"
      });
    });
  });
  
  // Find and stop all recorder tabs
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      console.log(`🛑 Stopping ${tabs.length} recorder tab(s)`);
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  
  currentRecordingTab = null;
  
  // Clear storage
  chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
}

// Monitor tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) {
    console.log("🛑 Recording source tab closed - stopping recording");
    stopAllRecordings();
  }
  
  // Also check if it's a recorder tab
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    
    if (tab.url && tab.url.includes("recorder.html")) {
      console.log("🛑 Recorder tab closed - cleaning up");
      chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
      currentRecordingTab = null;
    }
  });
});

// Handle extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log("🔧 Extension installed/updated:", details.reason);
  
  if (details.reason === 'install') {
    // Set default permissions
    chrome.storage.local.set({ autoRecordPermission: false });
    console.log("🔐 Auto recording disabled by default");
  }
});

// Keep service worker alive during recordings
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {
    if (currentRecordingTab) {
      // Log keep-alive every 30 seconds during recording
      if (Math.floor(Date.now() / 1000) % 30 === 0) {
        console.log("💓 Service worker keep-alive (Recording active)");
      }
    }
  });
}, 10000);

console.log("🔧 Background script loaded successfully");
console.log("📋 Detection mode: Join button click (+3s delay) = Meeting Start, Leave button click = Meeting End");






























