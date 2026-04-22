let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let meetingStartTimeout = null;
let ignoreAutoStopUntil = 0; // Timestamp to ignore auto-stop after small X click
function isMeetingPage() {
  const url = location.href;

  return url.includes("/wc/") && (
    url.includes("/join") ||
    url.includes("/start") ||
    url.match(/\/wc\/\d+/)
  );
}
console.log("✅ CONTENT.JS LOADED");

// Check auto record permission on load
console.log("🔐 Checking auto-record permission...");
checkAutoRecordPermission();

async function checkAutoRecordPermission() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔐 Auto record enabled:", autoRecordEnabled);
      resolve(autoRecordEnabled);
    });
  });
}

// DETECT MEETING USING MAIN CONTAINER
/*function setupNewMeetingDetection() {
  console.log("🎯 Setting up New Meeting detection...");

  function attachListener() {
    const newMeetingBtn = document.querySelector('button[aria-label="New meeting"]');

    if (newMeetingBtn && !newMeetingBtn.hasAttribute('data-listener')) {
      newMeetingBtn.setAttribute('data-listener', 'true');

      newMeetingBtn.addEventListener('click', () => {
        console.log("🚀 New Meeting button clicked");

        // Wait for Zoom to load meeting
        setTimeout(() => {
          console.log("🎬 Triggering auto recording after New Meeting click");

          isInMeeting = true;
          meetingStarted();   // 🔥 THIS is the key
        }, 3000);
      });

      console.log("✅ New Meeting listener attached");
    }
  }

  // Run immediately
  attachListener();

  // Keep checking (Zoom loads dynamically)
  setInterval(attachListener, 2000);
}*/


// DIRECT AGGRESSIVE BUTTON DETECTION
function setupEndButtonDetection() {
  console.log("🖱️ SHADOW DOM LEAVE BUTTON DETECTION - ACTIVATED!");
  
  // ============================================================
  // FUNCTION: SEARCH THROUGH SHADOW DOM RECURSIVELY
  // ============================================================
  function findInShadow(element, searchText) {
    try {
      // Check this element's text
      if (element.textContent && element.textContent.toLowerCase().includes(searchText.toLowerCase())) {
        return element;
      }
      
      // Check children
      if (element.children) {
        for (let child of element.children) {
          const result = findInShadow(child, searchText);
          if (result) return result;
        }
      }
      
      // Check Shadow DOM if exists
      if (element.shadowRoot) {
        for (let child of element.shadowRoot.children) {
          const result = findInShadow(child, searchText);
          if (result) return result;
        }
      }
    } catch (e) {
      // Ignore errors from restricted shadow roots
    }
    
    return null;
  }
  
  // ============================================================
  // DIRECT BUTTON DETECTION - KEEP RETRYING
  // ============================================================
  function attachLeaveButtonListener() {
    // EXACT SELECTOR 1: Leave Meeting button
    const leaveBtn = document.querySelector('#wc-footer > div.footer__inner.leave-option-container > div:nth-child(1) > div > div > button:nth-child(2)');
    
    // EXACT SELECTOR 2: End Meeting for All button
    const endForAllBtn = document.querySelector('#wc-footer > div.footer__inner.leave-option-container > div:nth-child(1) > div > div > button.zmu-btn.leave-meeting-options__btn.leave-meeting-options__btn--default.leave-meeting-options__btn--danger.zmu-btn--default.zmu-btn__outline--white');
    
    // If not found, search inside .leave-option-container for any buttons
    let leaveBtn2 = leaveBtn;
    let endForAllBtn2 = endForAllBtn;
    
    if (!leaveBtn || !endForAllBtn) {
      const container = document.querySelector('.leave-option-container');
      if (container) {
        const btns = container.querySelectorAll('button');
        console.log(`🔍 Found ${btns.length} buttons in leave-option-container`);
        
        btns.forEach((btn, idx) => {
          const text = btn.textContent.toLowerCase().trim();
          const classes = btn.className;
          
          if (!leaveBtn2 && (text === 'leave meeting' || text.includes('leave'))) {
            leaveBtn2 = btn;
            console.log(`✅ Button ${idx} IDENTIFIED AS LEAVE: "${text}"`);
          }
          if (!endForAllBtn2 && (text === 'end meeting for all' || classes.includes('leave-meeting-options__btn--danger'))) {
            endForAllBtn2 = btn;
            console.log(`✅ Button ${idx} IDENTIFIED AS END FOR ALL: "${text}"`);
          }
        });
      }
    }
    
    // Attach to Leave Meeting button
    if (leaveBtn2 && !leaveBtn2.hasAttribute('data-leave-listener')) {
      leaveBtn2.setAttribute('data-leave-listener', 'true');
      leaveBtn2.addEventListener('click', () => {
        console.log("🎯🎯🎯 LEAVE MEETING CLICKED - STOPPING NOW 🎯🎯🎯");
        stopRecording();
      });
      console.log("✅ LISTENER ATTACHED TO LEAVE MEETING BUTTON");
    }
    
    // Attach to End Meeting for All button
    if (endForAllBtn2 && !endForAllBtn2.hasAttribute('data-end-listener')) {
      endForAllBtn2.setAttribute('data-end-listener', 'true');
      endForAllBtn2.addEventListener('click', () => {
        console.log("🎯🎯🎯 END MEETING FOR ALL CLICKED - STOPPING NOW 🎯🎯🎯");
        stopRecording();
      });
      console.log("✅ LISTENER ATTACHED TO END MEETING FOR ALL BUTTON");
    }
  }
  
  // Attach listener immediately
  attachLeaveButtonListener();
  
  // Also search periodically in case buttons appear later (after joining)
  setInterval(() => {
    attachLeaveButtonListener();
  }, 2000);
  
  console.log("✅ Shadow DOM Leave button detection active");
}

// BACKUP: DETECT URL CHANGES (MEETING LEFT/ENDED)
function setupURLChangeDetection() {
  console.log("🌐 Setting up URL change detection...");
  
  let lastURL = window.location.href;
  console.log("🌐 Initial URL:", lastURL);
  
  // Monitor for URL changes
  const urlCheckInterval = setInterval(() => {
    const currentURL = window.location.href;
    
    if (currentURL !== lastURL) {
      console.log("🔄 URL CHANGED:", { 
        from: lastURL, 
        to: currentURL,
        isInMeeting: isInMeeting,
        recordingStarted: recordingStarted
      });
      
      // Check if we left a meeting page
      const wasMeetingURL = lastURL.includes('/wc/') && (
        lastURL.includes('/start') || 
        lastURL.includes('/join') ||
        lastURL.match(/\/wc\/\d+/)
      );
      
      const isMeetingURL = currentURL.includes('/wc/') && (
        currentURL.includes('/start') || 
        currentURL.includes('/join') ||
        currentURL.match(/\/wc\/\d+/)
      );
      
      console.log("🔄 URL Analysis:", {
        wasMeetingURL: wasMeetingURL,
        isMeetingURL: isMeetingURL,
        shouldStop: wasMeetingURL && !isMeetingURL && isInMeeting
      });
      
      // If we were in a meeting and now we're not, stop recording
      if (wasMeetingURL && !isMeetingURL && isInMeeting) {
        // BLOCK if small X button was just clicked
        if (Date.now() < ignoreAutoStopUntil) {
          console.log("⏱️ URL CHANGE AUTO-STOP BLOCKED - small X button was clicked");
          return;
        }
        console.log("🛑 *** URL CHANGED FROM MEETING TO HOME - USER LEFT MEETING! ***");
        stopRecording();
      }
      
      lastURL = currentURL;
    }
  }, 500);
  
  console.log("✅ URL change detection active");
}

// Also monitor for navigation events
window.addEventListener('beforeunload', () => {
  if (isInMeeting && recordingStarted) {
    console.log("🚨 PAGE UNLOADING WHILE IN MEETING - FORCE STOPPING RECORDING");
    chrome.runtime.sendMessage({ action: "autoStopRecording" }).catch(e => {
      console.log("⚠️ Could not send stop message:", e);
    });
  }
});

function startMeetingWithDelay() {
  if (isInMeeting) return;
  
  if (meetingStartTimeout) {
    clearTimeout(meetingStartTimeout);
  }
  
  console.log("⏰ Starting 3-second delay before recording...");
  
  meetingStartTimeout = setTimeout(() => {
    console.log("⏰ 3-second delay completed - starting meeting");
    meetingStarted();
  }, 3000);
}

async function meetingStarted() {
  if (isInMeeting && recordingStarted) return;

  console.log("🎯 MEETING STARTED");
  isInMeeting = true;

  setupEndButtonDetection();

  // 🔥 IMPORTANT FIX
  await checkAutoRecordPermission();

  if (autoRecordEnabled && !recordingStarted) {
    console.log("🎬 AUTO RECORDING STARTING");
    startAutoRecording();
  }

  showMeetingNotification("started");
  chrome.storage.local.set({ isInMeeting: isInMeeting });
}

function stopRecording() {
  console.log("🛑🛑🛑 STOP RECORDING CALLED - AGGRESSIVE MODE! 🛑🛑🛑");
  console.log("📊 Current state:", {
    isInMeeting: isInMeeting,
    recordingStarted: recordingStarted,
    meetingStartTimeout: meetingStartTimeout
  });
  
  // FORCE STOP - Send stop message directly to background
  console.log("📤 SENDING DIRECT STOP MESSAGE TO BACKGROUND");
  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    console.log("✅ STOP MESSAGE SENT - Response:", response);
    if (chrome.runtime.lastError) {
      console.error("❌ Error sending stop message:", chrome.runtime.lastError);
    }
  });
  
  // Also clear timeout if exists
  if (meetingStartTimeout) {
    clearTimeout(meetingStartTimeout);
    meetingStartTimeout = null;
    console.log("✅ Cleared meeting start timeout");
  }
  
  // Mark recording as stopped locally
  recordingStarted = false;
  isInMeeting = false;
  
  console.log("✅ STOP RECORDING AGGRESSIVE SEQUENCE COMPLETE");
}

function meetingEnded() {
  if (!isInMeeting) return;
  
  // ============================================================
  // SKIP AUTO-STOP if small X button was clicked (ignore for 5 seconds)
  // ============================================================
  if (Date.now() < ignoreAutoStopUntil) {
    console.log("⏱️ Auto-stop BLOCKED - small X button was clicked, waiting for user action");
    return;
  }
  
  console.log("🎯 MEETING ENDED - EXECUTING STOP SEQUENCE");
  console.log("📊 Current state:", {
    isInMeeting: isInMeeting,
    recordingStarted: recordingStarted
  });
  
  isInMeeting = false;
  
  if (recordingStarted) {
    console.log("⏹️ RECORDING ACTIVE - STOPPING AND DOWNLOADING NOW");
    stopAutoRecording();
  } else {
    console.log("ℹ️ Recording not active - just marking meeting as ended");
  }
  
  recordingStarted = false;
  showMeetingNotification("ended");
  chrome.storage.local.set({ isInMeeting: isInMeeting });
  
  console.log("✅ Meeting ended sequence complete");
}

function startAutoRecording() {
  if (recordingStarted) return;
  
  console.log("🎬 Starting auto recording...");
  recordingStarted = true;
  
  showRecordingPopup();
  
  chrome.runtime.sendMessage({ 
    action: "autoStartRecording"
  }, (response) => {
    if (response && response.success) {
      console.log("✅ Recording started successfully");
      showRecordingNotification("started");
    } else {
      console.log("❌ Recording failed to start");
      recordingStarted = false;
      hideRecordingPopup();
    }
  });
}

function stopAutoRecording() {
  if (!recordingStarted) return;
  
  console.log("🛑 STOPPING AUTO RECORDING - SENDING STOP MESSAGE TO BACKGROUND...");
  
  hideRecordingPopup();
  
  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("❌ ERROR sending stop message:", chrome.runtime.lastError);
    } else {
      console.log("✅ Stop message sent to background, response:", response);
      recordingStarted = false;
      showRecordingNotification("stopped");
    }
  });
  
  // Force timeout backup stop after 2 seconds if message doesn't work
  setTimeout(() => {
    if (recordingStarted) {
      console.log("⚠️ Recording still active after 2s - retrying stop message");
      chrome.runtime.sendMessage({ action: "autoStopRecording" });
    }
  }, 2000);
}

function resetRecordingState() {
  recordingStarted = false;
  isInMeeting = false;
  if (meetingStartTimeout) {
    clearTimeout(meetingStartTimeout);
    meetingStartTimeout = null;
  }
  hideRecordingPopup();
  console.log("🔄 Recording state reset");
}

function showMeetingNotification(type) {
  const existingNotification = document.getElementById('meeting-status-notification');
  if (existingNotification) existingNotification.remove();

  const notification = document.createElement('div');
  notification.id = 'meeting-status-notification';
  
  const currentTime = new Date().toLocaleTimeString();
  
  if (type === "started") {
    notification.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      background: #4CAF50; color: white; padding: 12px 18px; border-radius: 8px;
      z-index: 10000; font-family: Arial; font-size: 14px; font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid #45a049;
    `;
    notification.textContent = `🔴 Meeting Started - ${currentTime}`;
  } else {
    notification.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      background: #f44336; color: white; padding: 12px 18px; border-radius: 8px;
      z-index: 10000; font-family: Arial; font-size: 14px; font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid #d32f2f;
    `;
    notification.textContent = `⏹️ Meeting Ended - ${currentTime}`;
  }
  
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 5000);
}

function showRecordingNotification(type) {
  const notification = document.createElement('div');
  notification.id = 'recording-status-notification';
  notification.style.cssText = `
    position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
    background: ${type === 'started' ? '#2196F3' : '#FF9800'}; color: white;
    padding: 8px 12px; border-radius: 5px; z-index: 9999; font-family: Arial;
    font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  notification.textContent = type === 'started' 
    ? '🔴 Recording Started' 
    : '⏹️ Recording Stopped - Downloading...';
  
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 4000);
}

function showRecordingPopup() {
  const existingPopup = document.getElementById('recording-live-popup');
  if (existingPopup) existingPopup.remove();

  const popup = document.createElement('div');
  popup.id = 'recording-live-popup';
  popup.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; background: #d32f2f; color: white;
    padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: Arial;
    font-size: 14px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 2px solid #b71c1c; display: flex; align-items: center; gap: 8px;
    min-width: 180px;
  `;

  const redDot = document.createElement('div');
  redDot.style.cssText = `
    width: 12px; height: 12px; background: #ff4444; border-radius: 50%;
    animation: pulse 1.5s infinite;
  `;

  const text = document.createElement('span');
  text.id = 'recording-timer';
  text.textContent = '00:00';

  const recordingText = document.createElement('span');
  recordingText.textContent = 'Recording';

  popup.appendChild(redDot);
  popup.appendChild(text);
  popup.appendChild(recordingText);

  const style = document.createElement('style');
  style.textContent = `@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`;
  document.head.appendChild(style);

  document.body.appendChild(popup);
}

function updateRecordingTimer(time) {
  const timerElement = document.getElementById('recording-timer');
  if (timerElement) timerElement.textContent = time;
}

function hideRecordingPopup() {
  const popup = document.getElementById('recording-live-popup');
  if (popup) popup.remove();
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Content script received:", message.action);
  
  if (message.action === "updateAutoRecordPermission") {
    autoRecordEnabled = message.enabled;
    console.log("🔐 Auto record permission updated:", autoRecordEnabled);
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    sendResponse({ 
      isInMeeting: isInMeeting, 
      recording: recordingStarted,
      autoRecordEnabled: autoRecordEnabled
    });
  }

  if (message.action === "updateRecordingTimer") {
    updateRecordingTimer(message.time);
    sendResponse({ success: true });
  }

  if (message.action === "showRecordingPopup") {
    showRecordingPopup();
    sendResponse({ success: true });
  }

  if (message.action === "hideRecordingPopup") {
    hideRecordingPopup();
    sendResponse({ success: true });
  }
  
  return true;
});

// Page load detection
window.addEventListener('load', () => {
  console.log("🔄 Page loaded - resetting recording states");
  resetRecordingState();
  checkAutoRecordPermission().then(() => {
    console.log("🔄 Auto record permission rechecked:", autoRecordEnabled);
  });
});

// Initial setup
setTimeout(() => {
  console.log("🔧 Starting Auto Recorder...");
  //setupNewMeetingDetection();;
  setupEndButtonDetection();
  setupMuteDetection();
  addRecordingToggleUI();
  setupURLChangeDetection();
  console.log("✅ Auto Recorder initialized");
  console.log("📋 Detection: Main container = Start, Button click + URL change = Stop");
}, 1000);

console.log("🔍 Auto Recorder content script loaded");

setInterval(() => {
  const inMeeting = isMeetingPage();

  if (inMeeting && !isInMeeting) {
    console.log("🎯 Meeting detected (universal)");
    meetingStarted();
  }

  if (!inMeeting && isInMeeting) {
    console.log("🛑 Meeting ended (universal)");
    meetingEnded();
  }

}, 1000);

// ============================================================
// MUTE/UNMUTE DETECTION
// ============================================================
function setupMuteDetection() {
  console.log('🎧 Setting up mute/unmute detection');

  let lastMutedState = null;

  function detectMuteState() {
    // Search for buttons that likely control the microphone
    const buttons = Array.from(document.querySelectorAll('button'));
    let found = null;

    for (const b of buttons) {
      try {
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().trim();
        if (label.includes('mute') || label.includes('unmute') || label.includes('microphone')) {
          found = b;
          break;
        }
      } catch (e) { }
    }

    if (!found) {
      // nothing found — log for debug
      console.log('🎧 No mute/unmute button found during detection');
      return;
    }

    // Log element info for debugging
    try {
      console.log('🎧 Found candidate mute element:', found);
      console.log('🎧 outerHTML:', found.outerHTML);
      const attrs = {};
      for (let i = 0; i < found.attributes.length; i++) {
        const a = found.attributes[i]; attrs[a.name] = a.value;
      }
      console.log('🎧 attributes:', attrs);
    } catch (e) { }

    // Determine current state: if the button shows 'unmute' text/label, it means mic is currently muted
    const stateLabel = (found.getAttribute('aria-label') || found.getAttribute('title') || found.textContent || '').toLowerCase();
    const isMuted = stateLabel.includes('unmute') || stateLabel.includes('muted') || stateLabel.includes('unmute microphone') || stateLabel.includes('mic off');

    if (lastMutedState === null) {
      lastMutedState = isMuted;
      // initial sync
      console.log('🎧 Initial mute state detected:', isMuted);
      chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled: !isMuted }, (res) => {
        if (chrome.runtime.lastError) console.warn('⚠️ setRecordingAudioEnabled error:', chrome.runtime.lastError);
      });
      return;
    }

    if (isMuted !== lastMutedState) {
      lastMutedState = isMuted;
      console.log('🎧 Mute state changed:', isMuted);
      // disable audio when muted, enable when unmuted
      chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled: !isMuted }, (res) => {
        if (chrome.runtime.lastError) console.warn('⚠️ Could not send setRecordingAudioEnabled:', chrome.runtime.lastError);
        else console.log('📨 setRecordingAudioEnabled response:', res);
      });
    }
  }

  // Run periodically and also on clicks
  setInterval(detectMuteState, 1000);

  document.addEventListener('click', (e) => {
    // small debounce to allow UI label to update
    setTimeout(detectMuteState, 300);
  }, true);
}

// ============================================================
// Manual Recording Audio Toggle UI
// ============================================================
function addRecordingToggleUI() {
  if (document.getElementById('recording-audio-toggle')) return;

  const btn = document.createElement('button');
  btn.id = 'recording-audio-toggle';
  btn.textContent = 'Recording Audio: ON';
  btn.style.cssText = `
    position: fixed; bottom: 20px; left: 20px; z-index: 100000; padding: 8px 12px;
    background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
  `;

  let enabled = true;

  btn.addEventListener('click', () => {
    enabled = !enabled;
    btn.textContent = enabled ? 'Recording Audio: ON' : 'Recording Audio: OFF';
    chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled }, (res) => {
      if (chrome.runtime.lastError) console.warn('⚠️ setRecordingAudioEnabled error:', chrome.runtime.lastError);
      else console.log('📨 setRecordingAudioEnabled response:', res);
    });
  });

  document.body.appendChild(btn);

  // ensure toggle is removed on navigation
  window.addEventListener('beforeunload', () => {
    try { btn.remove(); } catch (e) {}
  });
}

// Deeper mute detection that searches shadow roots and attaches observers
function setupDeepMuteDetection() {
  console.log('🎧 Starting deep mute detection (shadow DOM aware)');

  function deepSearch(root, matcher) {
    try {
      // Check this node
      if (root.nodeType === Node.ELEMENT_NODE) {
        const el = root;
        if (matcher(el)) return el;
      }
      // Search children
      const children = root.children || [];
      for (let i = 0; i < children.length; i++) {
        const result = deepSearch(children[i], matcher);
        if (result) return result;
      }
      // Search shadow root
      if (root.shadowRoot) {
        const srKids = root.shadowRoot.children || [];
        for (let i = 0; i < srKids.length; i++) {
          const result = deepSearch(srKids[i], matcher);
          if (result) return result;
        }
      }
    } catch (e) { /* ignore cross-origin or read errors */ }
    return null;
  }

  function isMuteCandidate(el) {
    try {
      const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
      const text = (el.textContent || '').toLowerCase();
      const attrs = (label || '').toLowerCase();
      if (attrs.includes('mute') || attrs.includes('unmute') || attrs.includes('microphone') || text.includes('mute') || text.includes('unmute') || text.includes('mic')) {
        return true;
      }
      // also check svg <title> inside
      const svgTitle = el.querySelector && el.querySelector('svg title');
      if (svgTitle && (svgTitle.textContent || '').toLowerCase().includes('mute')) return true;
    } catch (e) {}
    return false;
  }

  let attached = false;

  async function findAndAttach() {
    if (attached) return;
    const candidate = deepSearch(document.body, isMuteCandidate);
    if (!candidate) {
      console.log('🎧 Deep search found no mute candidate');
      return;
    }

    console.log('🎧 Deep mute candidate found:', candidate);
    attached = true;

    // Observe attribute/text changes on the candidate to detect state changes
    const obs = new MutationObserver(() => {
      try {
        const stateLabel = (candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '').toLowerCase();
        const isMuted = stateLabel.includes('unmute') || stateLabel.includes('muted') || stateLabel.includes('mic off');
        console.log('🎧 Deep mute observer state:', isMuted, 'label:', stateLabel);
        chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled: !isMuted });
      } catch (e) { console.warn(e); }
    });

    obs.observe(candidate, { attributes: true, childList: true, subtree: true, characterData: true });

    // Also attach click listener
    candidate.addEventListener('click', () => {
      setTimeout(() => {
        try {
          const stateLabel = (candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '').toLowerCase();
          const isMuted = stateLabel.includes('unmute') || stateLabel.includes('muted') || stateLabel.includes('mic off');
          console.log('🎧 Deep mute click detected. New state:', isMuted);
          chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled: !isMuted });
        } catch (e) { console.warn(e); }
      }, 250);
    });

    // Trigger initial state
    try {
      const stateLabel = (candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '').toLowerCase();
      const isMuted = stateLabel.includes('unmute') || stateLabel.includes('muted') || stateLabel.includes('mic off');
      chrome.runtime.sendMessage({ action: 'setRecordingAudioEnabled', enabled: !isMuted });
    } catch (e) {}
  }

  // Try repeatedly for a while
  const interval = setInterval(() => {
    findAndAttach();
  }, 1000);

  // Stop after 30s
  setTimeout(() => clearInterval(interval), 30000);
}

// Start deep mute detection too
setTimeout(() => setupDeepMuteDetection(), 1500);