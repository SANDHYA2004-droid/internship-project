// This runs in a separate tab that stays open for recording
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let downloadCompleted = false;
// Audio control handles so other scripts can enable/disable audio during recording
let audioControls = null;

console.log("🎬 Recorder tab loaded");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨📨📨 RECORDER TAB MESSAGE RECEIVED 📨📨📨");
  console.log("Message:", message);
  console.log("Sender:", sender);
  
  if (message.action === "startRecording") {
    console.log("🎬 START RECORDING message received");
    isAutoRecord = message.autoRecord || false;
    startRecording(message.tabId);
    sendResponse({ success: true });
  }
  
  if (message.action === "stopRecording") {
    console.log("🛑🛑🛑 STOP RECORDING MESSAGE RECEIVED - EXECUTING NOW!!! 🛑🛑🛑");
    stopRecording();
    sendResponse({ success: true });
  }

  if (message.action === 'setRecordingAudioEnabled') {
    const enabled = !!message.enabled;
    console.log('📨 Received setRecordingAudioEnabled ->', enabled);
    if (audioControls) {
      try {
        audioControls.tabGain.gain.setValueAtTime(enabled ? 1 : 0, audioControls.audioContext.currentTime);
        audioControls.micGain.gain.setValueAtTime(enabled ? 1 : 0, audioControls.audioContext.currentTime);
        console.log('🔊 Audio controls updated to', enabled);
        sendResponse({ success: true });
      } catch (e) {
        console.error('❌ Failed to update audio controls:', e);
        sendResponse({ success: false, error: e.message });
      }
    } else {
      console.warn('⚠️ No audio controls available to update');
      sendResponse({ success: false, error: 'no-audio-controls' });
    }
  }

  // Also try to directly enable/disable any existing audio tracks on the MediaRecorder stream
  if (message.action === 'setRecordingAudioEnabled' && typeof message.enabled !== 'undefined') {
    try {
      const enabled = !!message.enabled;
      if (mediaRecorder && mediaRecorder.stream) {
        const audioTracks = mediaRecorder.stream.getAudioTracks();
        audioTracks.forEach(t => {
          try { t.enabled = enabled; } catch (e) { console.warn('⚠️ Could not set track.enabled:', e); }
        });
        console.log('🔇 MediaRecorder audio tracks set to enabled=', enabled, 'count=', audioTracks.length);
      }
    } catch (e) {
      console.warn('⚠️ Error toggling mediaRecorder audio tracks:', e);
    }
  }
  if (message.action === 'getAudioStatus') {
    console.log('📨 getAudioStatus requested');
    if (audioControls) {
      try {
        const status = {
          audioContextState: audioControls.audioContext.state,
          tabGain: audioControls.tabGain.gain.value,
          micGain: audioControls.micGain.gain.value
        };
        console.log('🔍 Audio status:', status);
        sendResponse({ success: true, status });
      } catch (e) {
        console.error('❌ Failed to read audio status:', e);
        sendResponse({ success: false, error: e.message });
      }
    } else {
      console.log('ℹ️ No audioControls available');
      sendResponse({ success: false, error: 'no-audio-controls' });
    }
  }
  
  return true;
});

async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);
  
  if (isRecording) {
    console.log("⚠️ Already recording, ignoring start request");
    return;
  }

  try {
    document.getElementById("status").textContent = "🟡 Starting recording...";
    console.log("📋 Getting tab capture permission for tab:", tabId);

    // Show recording popup immediately
    chrome.runtime.sendMessage({ action: "showRecordingPopup" });

    // Get tab stream using chrome.tabCapture when available, otherwise fall back to
    // navigator.mediaDevices.getDisplayMedia for cross-browser support.
    let tabStream;
    if (chrome && chrome.tabCapture && chrome.tabCapture.capture) {
      tabStream = await new Promise((resolve, reject) => {
        console.log("🎬 Capturing tab using chrome.tabCapture");

        chrome.tabCapture.capture({
          audio: true,
          video: true
        }, (stream) => {
          console.log("📌 Tab capture callback fired");

          if (chrome.runtime && chrome.runtime.lastError) {
            console.error("❌ Tab capture error:", chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!stream) {
            console.error("❌ No stream returned from tabCapture");
            reject(new Error("No stream from tabCapture"));
            return;
          }

          console.log("✅ Tab stream captured successfully (tabCapture)");
          resolve(stream);
        });
      });
    } else {
      // Fallback for browsers without tabCapture (Firefox, some Chromium builds). This
      // will prompt the user to share a screen/window/tab and allow audio if supported.
      try {
        console.log("🎬 chrome.tabCapture not available — using getDisplayMedia fallback");
        tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!tabStream) throw new Error('No stream from getDisplayMedia');
        console.log("✅ Tab stream captured successfully (getDisplayMedia)");
      } catch (err) {
        console.error('❌ getDisplayMedia failed:', err);
        throw err;
      }
    }

    console.log("✅ Tab stream captured, tracks:", tabStream.getTracks().length);

    let finalStream = tabStream;

    // Try to add microphone audio, but detect if mic is muted and skip audio in that case
    try {
      console.log("🎤 Attempting to capture microphone...");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 2
        },
        video: false
      });

      console.log("✅ Microphone captured");

      const micTrack = micStream.getAudioTracks()[0];
      let micMuted = false;

      // Read persisted audio enabled state from popup (if user toggled)
      let persistedAudioEnabled = true;
      try {
        const stored = await new Promise(resolve => chrome.storage.local.get(['recordingAudioEnabled'], resolve));
        if (stored && typeof stored.recordingAudioEnabled !== 'undefined') persistedAudioEnabled = !!stored.recordingAudioEnabled;
      } catch (e) {
        console.warn('⚠️ Failed to read persisted recordingAudioEnabled:', e);
      }

      // Quick checks: track may report enabled/muted
      if (micTrack) {
        if (micTrack.enabled === false || micTrack.muted === true) {
          micMuted = true;
          console.log("🔇 Mic track reports muted/disabled");
        }
      }

      // If not reported muted, do a brief level check to detect real muting/silence
      if (!micMuted && micTrack) {
        try {
          const checkCtx = new (window.AudioContext || window.webkitAudioContext)();
          const src = checkCtx.createMediaStreamSource(new MediaStream([micTrack]));
          const analyser = checkCtx.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          console.log("🎤 Mic RMS level check:", rms);
          // Threshold chosen conservatively; adjust if needed
          if (rms < 0.001) {
            micMuted = true;
            console.log("🔇 Mic level very low — treating as muted");
          }
          try { checkCtx.close(); } catch (e) { /* ignore */ }
        } catch (levelErr) {
          console.warn("⚠️ Mic level check failed:", levelErr);
        }
      }

      // Always create an AudioContext + destination and mix sources through gain nodes.
      // Use gain nodes to silence both sources when mic is muted, and restore when unmuted.
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      const destination = audioContext.createMediaStreamDestination();

      const tabAudioSource = audioContext.createMediaStreamSource(
        new MediaStream(tabStream.getAudioTracks())
      );
      const micAudioSource = audioContext.createMediaStreamSource(micStream);

      const tabGain = audioContext.createGain();
      const micGain = audioContext.createGain();

      // Track whether the mic was explicitly muted/disabled by the browser/app
      const explicitMicMuted = !!(micTrack && (micTrack.enabled === false || micTrack.muted === true));

      // Start with silence if mic is considered muted or user disabled audio via popup
      if (!persistedAudioEnabled) {
        tabGain.gain.value = 0;
        micGain.gain.value = 0;
        console.log('🔇 Starting with audio disabled by user (popup)');
      } else if (explicitMicMuted) {
        tabGain.gain.value = 0;
        micGain.gain.value = 0;
        console.log("🔇 Starting with audio muted (explicit mic mute) — no system or mic audio will be recorded");
      } else if (micMuted) {
        // micMuted here means very low level detected but not explicit mute; still start muted
        tabGain.gain.value = 0;
        micGain.gain.value = 0;
        console.log("🔇 Starting with audio muted (silent mic) — auto-unmute allowed on activity");
      } else {
        tabGain.gain.value = 1;
        micGain.gain.value = 1;
      }

      tabAudioSource.connect(tabGain).connect(destination);
      micAudioSource.connect(micGain).connect(destination);

      // Expose a simple dynamic unmute helper: listen for mic track unmute or level increases
      try {
        if (micTrack) {
          micTrack.addEventListener && micTrack.addEventListener('unmute', () => {
            console.log('🎤 Mic track unmute event — enabling audio');
            // On explicit unmute, allow audio
            tabGain.gain.setValueAtTime(1, audioContext.currentTime);
            micGain.gain.setValueAtTime(1, audioContext.currentTime);
            // mark that explicit mute is cleared by switching the flag via closure scope is not mutable here,
            // but we use the presence/absence of micTrack.muted/enabled below to decide behavior
          });
          micTrack.addEventListener && micTrack.addEventListener('mute', () => {
            console.log('🔇 Mic track mute event — disabling audio');
            tabGain.gain.setValueAtTime(0, audioContext.currentTime);
            micGain.gain.setValueAtTime(0, audioContext.currentTime);
          });
        }
      } catch (e) {
        console.warn('⚠️ Could not attach mic mute/unmute listeners:', e);
      }

      // Periodically check mic level and enable audio when significant signal detected
      const levelChecker = audioContext.createAnalyser();
      levelChecker.fftSize = 2048;
      const levelSrc = audioContext.createMediaStreamSource(new MediaStream([micTrack]));
      levelSrc.connect(levelChecker);
      const levelData = new Uint8Array(levelChecker.fftSize);
      let levelInterval = setInterval(() => {
        try {
          levelChecker.getByteTimeDomainData(levelData);
          let sum = 0;
          for (let i = 0; i < levelData.length; i++) {
            const v = (levelData[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / levelData.length);
          // If user speaks (rms threshold), enable gains — only if mic was NOT explicitly muted by the browser/app
          const currentlyExplicitMuted = !!(micTrack && (micTrack.enabled === false || micTrack.muted === true));
          if (!currentlyExplicitMuted && rms > 0.005) {
            if (tabGain.gain.value === 0 || micGain.gain.value === 0) {
              console.log('🎤 Mic activity detected (RMS=', rms.toFixed(4), ') — enabling audio');
              tabGain.gain.setValueAtTime(1, audioContext.currentTime);
              micGain.gain.setValueAtTime(1, audioContext.currentTime);
            }
          }
        } catch (e) {
          // ignore errors during level checks
        }
      }, 750);

      // When recording stops, clear the interval
      const cleanupLevelChecker = () => {
        try { clearInterval(levelInterval); } catch (e) {}
        try { levelInterval = null; } catch (e) {}
      };

      // Attach a stop listener to the tab stream's tracks to cleanup
      if (tabStream && tabStream.getTracks) {
        tabStream.getTracks().forEach(t => t.addEventListener && t.addEventListener('ended', cleanupLevelChecker));
      }

      // Create final stream with mixed audio (destination) and video tracks
      finalStream = new MediaStream([
        ...tabStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      // Save handles so other parts (content script) can toggle audio on/off
      audioControls = {
        tabGain,
        micGain,
        audioContext,
        destination
      };

      console.log("✅ Audio mixing prepared with dynamic mute handling");

    } catch (micError) {
      console.warn("⚠️ Microphone not available, using tab audio only:", micError);
      // Continue with tab audio only
      finalStream = tabStream;
    }

    // Setup MediaRecorder
    console.log("📹 Setting up MediaRecorder");
    console.log("📊 Final stream tracks - Video:", finalStream.getVideoTracks().length, "Audio:", finalStream.getAudioTracks().length);
    
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];

    let supportedType = 'video/webm';
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        supportedType = type;
        console.log("✅ Supported MIME type found:", supportedType);
        break;
      }
    }
    
    console.log("🎥 Using MIME type:", supportedType);

    try {
      mediaRecorder = new MediaRecorder(finalStream, {
        mimeType: supportedType,
        videoBitsPerSecond: 2500000,
        audioBitsPerSecond: 128000
      });
      console.log("✅ MediaRecorder created successfully");
    } catch (recordError) {
      console.error("❌ Failed to create MediaRecorder:", recordError);
      // Fallback: try without MIME type
      console.warn("⚠️ Trying MediaRecorder without MIME type...");
      try {
        mediaRecorder = new MediaRecorder(finalStream);
        console.log("✅ MediaRecorder created (no MIME type)");
      } catch (fallbackError) {
        console.error("❌ Failed to create MediaRecorder even without MIME type:", fallbackError);
        throw new Error("Cannot create MediaRecorder: " + fallbackError.message);
      }
    }

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    downloadCompleted = false;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log("📦 Data chunk:", event.data.size, "bytes, total chunks:", recordedChunks.length);
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
    };

    mediaRecorder.onerror = (event) => {
      console.error("❌ MediaRecorder error:", event);
      document.getElementById("status").textContent = "❌ Recording error";
      cleanup();
    };

    // Start recording with 1-second chunks
    mediaRecorder.start(1000);
    console.log("✅ Recording started in background tab!");

    // Update UI
    document.getElementById("status").textContent = isAutoRecord 
      ? "🟢 Auto Recording in background..." 
      : "🟢 Recording in background...";
    startTimer();

    // Save recording state to storage
    await chrome.storage.local.set({ 
      isRecording: true,
      recordingStartTime: recordingStartTime
    });

    // Notify background
    chrome.runtime.sendMessage({ action: "recordingStarted" });

  } catch (error) {
    console.error("❌ Recording start FAILED with error:", error);
    console.error("❌ Error name:", error.name);
    console.error("❌ Error message:", error.message);
    console.error("❌ Error stack:", error.stack);
    
    document.getElementById("status").textContent = "❌ Recording failed: " + error.message;
    
    // Hide recording popup on error
    chrome.runtime.sendMessage({ action: "hideRecordingPopup" });
    
    // Show retry button for auto recordings
    if (isAutoRecord) {
      const retryButton = document.createElement('button');
      retryButton.textContent = 'Retry Recording';
      retryButton.style.cssText = `
        padding: 10px 20px;
        margin: 10px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      `;
      retryButton.onclick = () => startRecording(tabId);
      document.body.appendChild(retryButton);
    }
  }
}

function stopRecording() {
  console.log("🛑 STOP RECORDING called");
  
  if (!mediaRecorder) return;
  
  if (mediaRecorder.state === 'recording') {
    isRecording = false;
    mediaRecorder.stop();
  }
  
  chrome.runtime.sendMessage({ action: "hideRecordingPopup" });
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    seconds++;
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeString = `${minutes}:${secs}`;
    
    timerEl.textContent = timeString;
    
    // Save time to storage
    chrome.storage.local.set({ recordingTime: timeString });
    
    // Send timer update to background and content script
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeString });
    
    // Send timer update to content script for the popup
    chrome.runtime.sendMessage({ 
      action: "updateRecordingTimer", 
      time: timeString 
    });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function downloadRecording() {
  console.log("💾💾💾 DOWNLOAD RECORDING CALLED 💾💾💾");
  console.log("📊 Chunks available:", recordedChunks.length);
  
  if (recordedChunks.length === 0) {
    console.warn("⚠️ No recorded data - cannot download");
    document.getElementById("status").textContent = "❌ No recording data to save";
    cleanup();
    return;
  }

  try {
    console.log("💾 Creating Blob from", recordedChunks.length, "chunks");
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    console.log("✅ Blob created, size:", blob.size, "bytes");
    
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('Z')[0];
    const filename = `zoom-recording-${timestamp}.webm`;

    console.log("💾 DOWNLOADING NOW:", filename);
    console.log("📊 File size:", blob.size, "bytes");

    // Download automatically without "Save As" popup
    chrome.downloads.download({
      url: url,
      filename: filename
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("❌ DOWNLOAD ERROR:", chrome.runtime.lastError);
        document.getElementById("status").textContent = "❌ Download error: " + chrome.runtime.lastError.message;
        fallbackDownload(blob, filename);
      } else {
        console.log("✅✅✅ DOWNLOAD STARTED WITH ID:", downloadId, "✅✅✅");
        document.getElementById("status").textContent = "✅ Recording saved to Downloads!";
        downloadCompleted = true;
        
        // Mark chunks as downloaded to prevent redownload
        recordedChunks = [];
        
        // Cleanup after successful download
        setTimeout(() => {
          console.log("🧹 Cleaning up after download");
          cleanup();
        }, 2000);
      }
    });

  } catch (error) {
    console.error("Download failed:", error);
    cleanup();
  }
}

function cleanup() {
  console.log("Cleanup");
  isRecording = false;
  recordedChunks = [];
  
  if (timerInterval) clearInterval(timerInterval);
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  // Close audio context if present
  try {
    if (audioControls && audioControls.audioContext) {
      audioControls.audioContext.close();
    }
  } catch (e) {
    console.warn('⚠️ Error closing audioContext:', e);
  }
  audioControls = null;
  
  chrome.storage.local.remove(['isRecording', 'recordingTime']);
  chrome.runtime.sendMessage({ action: "recordingStopped" });
}