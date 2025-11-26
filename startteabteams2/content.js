













let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let joinButtonObserver = null;
let meetingStartTimeout = null;

// Check auto record permission on load
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

function findJoinButton() {
  // Look for the prejoin join button
  const joinButton = document.getElementById('prejoin-join-button');
  if (joinButton) {
    console.log("🔍 Found Join button:", {
      id: joinButton.id,
      text: joinButton.textContent,
      visible: isElementVisible(joinButton)
    });
    return joinButton;
  }
  
  // Also check for other join button selectors as fallback
  const fallbackSelectors = [
    'button[data-tid="prejoin-join-button"]',
    'button[aria-label*="Join"]',
    'button[aria-label*="join"]',
    '.join-button',
    'button[title*="Join"]',
    'button[title*="join"]'
  ];
  
  for (const selector of fallbackSelectors) {
    const button = document.querySelector(selector);
    if (button && isElementVisible(button)) {
      console.log("🔍 Found Join button with selector:", selector);
      return button;
    }
  }
  
  return null;
}

function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0' &&
         rect.width > 0 && 
         rect.height > 0 &&
         element.offsetParent !== null;
}

function setupJoinButtonClickHandler() {
  // Remove existing listeners to prevent duplicates
  document.removeEventListener('click', handleJoinButtonClick, true);
  
  // Add new listener
  document.addEventListener('click', handleJoinButtonClick, true);
  console.log("🖱️ Join button click handler activated");
}

function handleJoinButtonClick(event) {
  // Check if the clicked element or its parent is the join button
  let target = event.target;
  
  // Traverse up the DOM to find join button
  while (target && target !== document.body) {
    if (isJoinButton(target)) {
      console.log("🎯 JOIN BUTTON CLICKED - User is joining meeting");
      
      // Clear any existing timeout
      if (meetingStartTimeout) {
        clearTimeout(meetingStartTimeout);
      }
      
      console.log("⏰ Starting 3-second delay before recording...");
      
      // Start meeting after 3 seconds to allow meeting to load
      meetingStartTimeout = setTimeout(() => {
        console.log("⏰ 3-second delay completed - starting meeting detection");
        meetingStarted();
      }, 3000); // 3 seconds delay
      
      break;
    }
    target = target.parentElement;
  }
}

function isJoinButton(element) {
  if (!element) return false;
  
  // Check by ID (primary method)
  if (element.id === 'prejoin-join-button') return true;
  
  // Check by data-tid attribute
  if (element.getAttribute('data-tid') === 'prejoin-join-button') return true;
  
  // Check by attributes and text content
  const ariaLabel = element.getAttribute('aria-label') || '';
  const title = element.getAttribute('title') || '';
  const textContent = element.textContent || '';
  
  return (ariaLabel.toLowerCase().includes('join') && 
          !ariaLabel.toLowerCase().includes('leave')) ||
         (title.toLowerCase().includes('join') &&
          !title.toLowerCase().includes('leave')) ||
         textContent.toLowerCase().includes('join now') ||
         textContent.trim() === 'Join now';
}

function setupLeaveButtonClickHandler() {
  // Remove existing listeners to prevent duplicates
  document.removeEventListener('click', handleLeaveButtonClick, true);
  
  // Add new listener
  document.addEventListener('click', handleLeaveButtonClick, true);
  console.log("🖱️ Leave button click handler activated");
}

function handleLeaveButtonClick(event) {
  // Check if the clicked element or its parent is the leave button
  let target = event.target;
  
  // Traverse up the DOM to find leave button
  while (target && target !== document.body) {
    if (isLeaveButton(target)) {
      console.log("🛑 LEAVE BUTTON CLICKED - Meeting ended by user");
      
      // Clear any pending meeting start timeout
      if (meetingStartTimeout) {
        clearTimeout(meetingStartTimeout);
        meetingStartTimeout = null;
      }
      
      meetingEnded();
      break;
    }
    target = target.parentElement;
  }
}

function isLeaveButton(element) {
  if (!element) return false;
  
  // Check by ID
  if (element.id === 'hangup-button') return true;
  
  // Check by attributes
  const ariaLabel = element.getAttribute('aria-label') || '';
  const title = element.getAttribute('title') || '';
  const dataTid = element.getAttribute('data-tid') || '';
  
  return ariaLabel.toLowerCase().includes('leave') ||
         ariaLabel.toLowerCase().includes('hang up') ||
         title.toLowerCase().includes('leave') ||
         title.toLowerCase().includes('hang up') ||
         dataTid.includes('hangup') ||
         element.classList.contains('hangup-button');
}

function meetingStarted() {
  if (isInMeeting) {
    console.log("⚠️ Already in meeting, ignoring duplicate start");
    return;
  }
  
  const startTime = new Date().toLocaleTimeString();
  console.log(`🎯 MEETING STARTED - 3-second delay completed at ${startTime}`);
  console.log(`🔐 Auto record enabled: ${autoRecordEnabled}`);
  console.log(`🎬 Recording started: ${recordingStarted}`);
  
  isInMeeting = true;
  
  // Reset recording state to ensure clean start
  recordingStarted = false;
  
  // Start auto recording if enabled
  if (autoRecordEnabled && !recordingStarted) {
    console.log("🎬 AUTO RECORDING - Starting recording after delay");
    startAutoRecording();
  } else {
    console.log("ℹ️ Auto recording not enabled or already recording");
  }
  
  showMeetingNotification("started");
  
  // Update storage
  chrome.storage.local.set({ isInMeeting: isInMeeting });
}

function meetingEnded() {
  if (!isInMeeting) return;
  
  const endTime = new Date().toLocaleTimeString();
  console.log(`🎯 MEETING ENDED - Leave button was clicked at ${endTime}`);
  isInMeeting = false;
  
  // Stop recording if active
  if (recordingStarted) {
    console.log("⏹️ AUTO STOPPING - Stopping recording due to meeting end");
    stopAutoRecording();
  }
  
  // Reset states
  recordingStarted = false;
  
  showMeetingNotification("ended");
  
  // Update storage
  chrome.storage.local.set({ isInMeeting: isInMeeting });
}

function startAutoRecording() {
  if (recordingStarted) {
    console.log("⚠️ Recording already started, ignoring auto-record request");
    return;
  }
  
  console.log("🎬 Attempting auto recording start...");
  recordingStarted = true;
  
  // Show recording popup immediately
  showRecordingPopup();
  
  chrome.runtime.sendMessage({ 
    action: "autoStartRecording"
  }, (response) => {
    if (response && response.success) {
      console.log("✅ Auto recording started successfully");
      showRecordingNotification("started");
    } else {
      console.log("❌ Auto recording failed to start");
      recordingStarted = false; // Reset on failure
      hideRecordingPopup();
    }
  });
}

function stopAutoRecording() {
  if (!recordingStarted) return;
  
  console.log("🛑 Attempting auto recording stop...");
  
  // Hide recording popup immediately
  hideRecordingPopup();
  
  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    if (response && response.success) {
      console.log("✅ Auto recording stopped successfully");
      recordingStarted = false; // Reset state
      showRecordingNotification("stopped");
    } else {
      console.log("❌ Auto recording failed to stop");
    }
  });
}

// Add this function to reset states
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
  // Remove existing notification
  const existingNotification = document.getElementById('meeting-status-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'meeting-status-notification';
  
  const currentTime = new Date().toLocaleTimeString();
  
  if (type === "started") {
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #4CAF50;
      color: white;
      padding: 12px 18px;
      border-radius: 8px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 2px solid #45a049;
    `;
    notification.textContent = `🔴 Meeting Started - ${currentTime}`;
  } else {
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #f44336;
      color: white;
      padding: 12px 18px;
      border-radius: 8px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 2px solid #d32f2f;
    `;
    notification.textContent = `⏹️ Meeting Ended - ${currentTime}`;
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5000);
}

function showRecordingNotification(type) {
  const notification = document.createElement('div');
  notification.id = 'recording-status-notification';
  notification.style.cssText = `
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'started' ? '#2196F3' : '#FF9800'};
    color: white;
    padding: 8px 12px;
    border-radius: 5px;
    z-index: 9999;
    font-family: Arial, sans-serif;
    font-size: 11px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  notification.textContent = type === 'started' 
    ? '🔴 Recording Started' 
    : '⏹️ Recording Stopped - Downloading...';
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 4000);
}

// Recording Popup Functions
function showRecordingPopup() {
  // Remove existing popup if any
  const existingPopup = document.getElementById('recording-live-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  const popup = document.createElement('div');
  popup.id = 'recording-live-popup';
  popup.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #d32f2f;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    z-index: 10000;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 2px solid #b71c1c;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 180px;
  `;

  const redDot = document.createElement('div');
  redDot.style.cssText = `
    width: 12px;
    height: 12px;
    background: #ff4444;
    border-radius: 50%;
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

  // Add pulse animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.5; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(popup);
}

function updateRecordingTimer(time) {
  const timerElement = document.getElementById('recording-timer');
  if (timerElement) {
    timerElement.textContent = time;
  }
}

function hideRecordingPopup() {
  const popup = document.getElementById('recording-live-popup');
  if (popup) {
    popup.remove();
  }
}

// Enhanced Mutation Observer for join button appearance
function setupJoinButtonObserver() {
  if (joinButtonObserver) {
    joinButtonObserver.disconnect();
  }

  joinButtonObserver = new MutationObserver((mutations) => {
    let joinButtonAppeared = false;
    
    mutations.forEach((mutation) => {
      // Check for added nodes that might be join button
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && (
            node.id === 'prejoin-join-button' || 
            node.getAttribute('data-tid') === 'prejoin-join-button' ||
            (node.getAttribute('aria-label') && node.getAttribute('aria-label').toLowerCase().includes('join'))
          )) {
            console.log("➕ Join button added to DOM");
            joinButtonAppeared = true;
          }
        });
      }
      
      // Check for attribute changes on join button
      if (mutation.type === 'attributes' && 
          (mutation.target.id === 'prejoin-join-button' || 
           mutation.target.getAttribute('data-tid') === 'prejoin-join-button' ||
           (mutation.target.getAttribute('aria-label') && mutation.target.getAttribute('aria-label').toLowerCase().includes('join')))) {
        console.log("⚡ Join button attribute changed:", mutation.attributeName);
        joinButtonAppeared = true;
      }
    });
    
    if (joinButtonAppeared) {
      console.log("🔍 Join button state changed, setting up click handler...");
      setTimeout(() => {
        setupJoinButtonClickHandler();
        setupLeaveButtonClickHandler();
      }, 500);
    }
  });

  // Start observing for join button specifically
  joinButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'aria-hidden', 'disabled', 'id', 'data-tid', 'aria-label', 'title']
  });
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

// Initialize observers and handlers
function initializeDetection() {
  setupJoinButtonObserver();
  setupJoinButtonClickHandler();
  setupLeaveButtonClickHandler();
  
  // Check if join button already exists
  const existingJoinButton = findJoinButton();
  if (existingJoinButton) {
    console.log("✅ Join button already present on page");
  }
  
  // Also monitor URL changes
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log("🔗 URL changed, reinitializing detection...");
      setTimeout(() => {
        initializeDetection();
      }, 2000);
    }
  });
  
  urlObserver.observe(document, { subtree: true, childList: true });
}

// Add page refresh detection
window.addEventListener('load', () => {
  console.log("🔄 Page loaded - resetting recording states");
  resetRecordingState();
  
  // Re-check auto record permission
  checkAutoRecordPermission().then(() => {
    console.log("🔄 Auto record permission rechecked after page load:", autoRecordEnabled);
  });
});

// Also check for meeting page directly
function checkIfInMeetingPage() {
  const currentUrl = window.location.href;
  const meetingIndicators = [
    'meeting',
    'call',
    'conference',
    'join'
  ];
  
  const isMeetingPage = meetingIndicators.some(indicator => 
    currentUrl.toLowerCase().includes(indicator)
  );
  
  if (isMeetingPage && !isInMeeting) {
    console.log("🔍 Detected meeting page URL - setting up meeting detection");
    // If we're on a meeting page but not detected as in meeting, set up detection
    setupLeaveButtonClickHandler();
  }
}

// Initial setup
setTimeout(() => {
  initializeDetection();
  checkIfInMeetingPage();
  console.log("🔍 Teams Auto Recorder initialized");
  console.log("📋 Detection mode: Join button click (+3s delay) = Meeting Start, Leave button click = Meeting End");
}, 1500);

console.log("🔍 Teams Auto Recorder content script loaded");







































































