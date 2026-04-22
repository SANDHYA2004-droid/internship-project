let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for tab updates to detect Zoom pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isZoomTab(tab.url)) {
    console.log("✅ Zoom tab detected:", tabId, tab.url);
    
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

function isZoomTab(url) {
  return url && (url.includes("zoom.us") || url.includes("zoom.com"));
}

// Handle permission messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    console.log("✅ User granted auto recording permission");
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => {
      // Notify all Zoom tabs about permission change
      chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
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
      // Notify all Zoom tabs about permission change
      chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
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

  if (message.action === 'setRecordingAudioEnabled') {
    // Forward audio enable/disable to recorder tab(s)
    const enabled = !!message.enabled;
    console.log('📨 Background forwarding setRecordingAudioEnabled ->', enabled);

    // If we know the current recorder tab id, send directly
    if (currentRecordingTab) {
      chrome.tabs.sendMessage(currentRecordingTab, { action: 'setRecordingAudioEnabled', enabled }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('⚠️ Could not forward to currentRecordingTab:', chrome.runtime.lastError);
        } else {
          console.log('✅ Forwarded setRecordingAudioEnabled to currentRecordingTab', currentRecordingTab);
        }
      });
    }

    // Also try to find any recorder tabs and forward
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        try {
          if (tab.url && tab.url.includes('recorder.html')) {
            chrome.tabs.sendMessage(tab.id, { action: 'setRecordingAudioEnabled', enabled }, (res) => {
              if (chrome.runtime.lastError) {
                // ignore
              } else {
                console.log('✅ Forwarded setRecordingAudioEnabled to recorder tab', tab.id);
              }
            });
          }
        } catch (e) { }
      });
    });

    sendResponse({ success: true });
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
    
    // Forward timer update to all Zoom tabs for the popup
    chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
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
    // Forward timer update to all Zoom tabs for the popup
    chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
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
    // Show popup in all Zoom tabs
    chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: "showRecordingPopup"
        });
      });
    });
    sendResponse({ success: true });
  }

  if (message.action === "hideRecordingPopup") {
    // Hide popup in all Zoom tabs
    chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
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

    console.log("🎬 Starting AUTO recording for Zoom tab:", tabId);
    
    // Show recording popup in Zoom tab
    chrome.tabs.sendMessage(tabId, {
      action: "showRecordingPopup"
    });
    
    // Create a new tab for recording
    chrome.tabs.create({
      url: chrome.runtime.getURL("recorder.html"),
      active: false
    }, (recorderTab) => {
      console.log("✅ Recorder tab opened for auto recording:", recorderTab.id);
      
      
      // Give recorder tab more time to load
      const startRecordingWithRetry = (retry = 0) => {
  chrome.tabs.sendMessage(recorderTab.id, { 
    action: "startRecording", 
    tabId: tabId,
    autoRecord: true
  }, (response) => {

    if (chrome.runtime.lastError) {
      console.log(`⏳ Recorder not ready (try ${retry + 1})`);

      if (retry < 5) {
        setTimeout(() => startRecordingWithRetry(retry + 1), 1000);
      } else {
        console.error("❌ Recorder failed to start after retries");
      }

    } else {
      console.log("✅ Auto recording started successfully");
    }
  });
};

// Start after small delay
setTimeout(() => startRecordingWithRetry(), 1500);
    });
  });
}

function stopAllRecordings() {
  console.log("🛑🛑🛑 AGGRESSIVE STOP ALL RECORDINGS INITIATED 🛑🛑🛑");
  
  // Hide recording popup in all Zoom tabs
  chrome.tabs.query({url: ["https://*.zoom.us/*", "https://zoom.us/*"]}, (tabs) => {
    console.log(`📤 Sending hideRecordingPopup to ${tabs.length} Zoom tabs`);
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "hideRecordingPopup"
      }).catch(err => {
        console.log("⚠️ Could not hide popup in tab:", err);
      });
    });
  });
  
  // AGGRESSIVE: Find and stop ALL recorder tabs immediately
  chrome.tabs.query({}, (allTabs) => {
    const recorderTabs = allTabs.filter(tab => {
      return tab.url && (
        tab.url.includes("recorder.html") || 
        tab.url.startsWith("chrome-extension://") && tab.url.includes("recorder.html")
      );
    });
    
    console.log(`🔍 SEARCHING FOR RECORDER TABS: Found ${recorderTabs.length} from ${allTabs.length} total tabs`);
    
    if (recorderTabs.length > 0) {
      console.log(`🛑🛑🛑 FOUND ${recorderTabs.length} RECORDER TAB(S) - SENDING STOP NOW! 🛑🛑🛑`);
      recorderTabs.forEach((tab, index) => {
        console.log(`📤 [${index + 1}/${recorderTabs.length}] Sending STOP RECORDING to tab ID: ${tab.id}`);
        console.log(`    Tab URL: ${tab.url}`);
        
        // Send the stop message
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`❌ Failed to send stop to tab ${tab.id}:`, chrome.runtime.lastError);
            // Close tab if message fails
            chrome.tabs.remove(tab.id).catch(err => {
              console.log("Could not close tab:", err);
            });
          } else {
            console.log(`✅ Stop message delivered to tab ${tab.id}, response:`, response);
          }
        });
      });
    } else {
      console.log("⚠️⚠️⚠️ NO RECORDER TABS FOUND! Checking all tabs...");
      console.log("All tabs:", allTabs.map(t => ({ id: t.id, url: t.url })));
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