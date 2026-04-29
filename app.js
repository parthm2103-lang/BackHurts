/* ================================================================
   BackHurts — AI Posture Monitor
   Roboflow model: backhurts/1
   ================================================================ */

const API_KEY   = 'odybs5xgBZ0Vixi1EfCb';
const MODEL_ID  = 'backhurts/2';
const API_URL   = `https://serverless.roboflow.com/${MODEL_ID}?api_key=${API_KEY}`;

// ── DOM REFS ────────────────────────────────────────────────────
const video           = document.getElementById('webcamVideo');
const overlayCanvas   = document.getElementById('overlayCanvas');
const inferCanvas     = document.getElementById('inferenceCanvas');
const cameraIdle      = document.getElementById('cameraIdle');
const postureOverlay  = document.getElementById('postureOverlayBadge');
const postureOverlayT = document.getElementById('postureOverlayText');
const scanLine        = document.getElementById('scanLine');
const liveBadge       = document.getElementById('liveBadge');
const liveDot         = liveBadge.querySelector('.live-dot');
const liveText        = liveBadge.querySelector('.live-text');
const fpsCounter      = document.getElementById('fpsCounter');

const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const snapshotBtn     = document.getElementById('snapshotBtn');
const resetStatsBtn   = document.getElementById('resetStatsBtn');
const clearLogBtn     = document.getElementById('clearLogBtn');
const dismissOverlay  = document.getElementById('dismissOverlay');
const soundToggle     = document.getElementById('soundToggle');
const soundIcon       = document.getElementById('soundIcon');

const statusCard      = document.getElementById('statusCard');
const statusIconWrap  = document.getElementById('statusIconWrap');
const statusIcon      = document.getElementById('statusIcon');
const statusLabel     = document.getElementById('statusLabel');
const statusSub       = document.getElementById('statusSub');
const confidencePill  = document.getElementById('confidencePill');
const confBarFill     = document.getElementById('confidenceBarFill');

const goodTimeEl      = document.getElementById('goodTime');
const badTimeEl       = document.getElementById('badTime');
const alertCountEl    = document.getElementById('alertCount');

const alertDelayEl    = document.getElementById('alertDelay');
const alertDelayVal   = document.getElementById('alertDelayVal');
const detectIntervalEl= document.getElementById('detectInterval');
const detectIntervalV = document.getElementById('detectIntervalVal');
const minConfidenceEl = document.getElementById('minConfidence');
const minConfidenceV  = document.getElementById('minConfidenceVal');

const historyScroll   = document.getElementById('historyScroll');
const historyEmpty    = document.getElementById('historyEmpty');
const toastContainer  = document.getElementById('toastContainer');
const badOverlay       = document.getElementById('badPostureOverlay');
const warningBar       = document.getElementById('postureWarningBar');
const warningBarText   = document.getElementById('warningBarText');
const dismissWarningBarBtn = document.getElementById('dismissWarningBar');
const snoozeOverlayBtn = document.getElementById('snoozeOverlay');

const overlayCtx      = overlayCanvas.getContext('2d');
const inferCtx        = inferCanvas.getContext('2d');

// ── STATE ───────────────────────────────────────────────────────
let stream        = null;
let detectLoop    = null;
let statsLoop     = null;
let isMuted       = false;
let isRunning     = false;
let snoozedUntil  = 0;   // timestamp until which alerts are snoozed

let goodSec       = 0;    // seconds in good posture
let badSec        = 0;    // seconds in bad/warn posture
let alertFired    = 0;
let consecutiveBadSec = 0;
let lastPostureClass  = null;

let fpsFrames     = 0;
let fpsTime       = Date.now();
let lastDetectTime= 0;

// Posture class → display config
// PRIMARY: Numeric class ID mapping (specific to the backhurts/1 model)
//   Class 2 = Good Posture (sitting straight/upright) - BASED ON USER FEEDBACK
//   Class 1 = Needs Correction
//   Class 0 = Bad Posture
//   Class 3 = Bad Posture (leaning forward)
// SECONDARY: text keyword matching as a universal fallback
function classifyPosture(rawClass) {
  const raw = (rawClass || '').trim();

  // ── Numeric class ID (highest priority) ───────────────────────
  // UPDATED: Mapping for Version 2 (Retrained)
  // 0 = Good Posture, 1 = Bad Posture, 2 = Neutral/Side, 3 = Partial
  const numericMap = { '0': 'good', '1': 'bad', '2': 'warn', '3': 'bad' };
  if (numericMap[raw] !== undefined) return numericMap[raw];

  // ── Text keyword fallback ──────────────────────────────────────
  const c = raw.toLowerCase().replace(/[\s_-]+/g, '');

  const badKeywords  = [
    'bad', 'poor', 'slouch', 'incorrect', 'wrong', 'hunch',
    'forward', 'lean', 'droop', 'curve', 'kyphosis', 'improper'
  ];
  if (badKeywords.some(k => c.includes(k))) return 'bad';

  const warnKeywords = [
    'correction', 'adjust', 'minor', 'warning', 'caution',
    'moderate', 'intermediate', 'round'
  ];
  if (warnKeywords.some(k => c.includes(k))) return 'warn';

  // good / correct / straight / normal / sitting → good
  const goodKeywords = [
    'good', 'correct', 'straight', 'upright', 'normal', 'proper', 'sitting'
  ];
  if (goodKeywords.some(k => c.includes(k))) return 'good';

  // Truly unknown class → log it and default to good (non-alarmist)
  console.warn(`[BackHurts] Unknown class "${rawClass}" — defaulting to good. Add it to the map!`);
  return 'good';
}

const POSTURE_CONFIG = {
  good: {
    label: 'Good Posture',
    sub:   'Keep it up! Your posture looks great.',
    icon:  `<svg class="status-icon" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="16" r="10" stroke="currentColor" stroke-width="3"/>
              <path d="M40 28C28 28 22 38 24 58L32 58C30 46 34 40 40 40C46 40 50 46 48 58L56 58C58 38 52 28 40 28Z" stroke="currentColor" stroke-width="3" fill="none"/>
              <rect x="34" y="58" width="12" height="10" rx="2" stroke="currentColor" stroke-width="3"/>
              <path d="M52 44L56 48L64 38" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`,
    overlayColor: '#22d3a3',
    badgeText: '✅ Good Posture',
  },
  bad: {
    label: 'Bad Posture!',
    sub:   'Please sit up straight and adjust your back.',
    icon:  `<svg class="status-icon" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="16" r="10" stroke="currentColor" stroke-width="3"/>
              <path d="M40 28C28 28 20 36 26 58L34 58C30 46 30 40 40 40C48 40 52 46 54 58L62 58C66 36 52 28 40 28Z" stroke="currentColor" stroke-width="3" fill="none"/>
              <rect x="34" y="58" width="12" height="10" rx="2" stroke="currentColor" stroke-width="3"/>
              <line x1="52" y1="38" x2="62" y2="48" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="62" y1="38" x2="52" y2="48" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>`,
    overlayColor: '#f05a7e',
    badgeText: '⚠️ Bad Posture',
  },
  warn: {
    label: 'Needs Correction',
    sub:   'Minor adjustment needed. Check your shoulder alignment.',
    icon:  `<svg class="status-icon" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="16" r="10" stroke="currentColor" stroke-width="3"/>
              <path d="M40 28C28 28 22 38 24 58L32 58C30 46 34 42 40 40C46 38 50 46 50 58L58 58C60 38 52 28 40 28Z" stroke="currentColor" stroke-width="3" fill="none"/>
              <rect x="34" y="58" width="12" height="10" rx="2" stroke="currentColor" stroke-width="3"/>
              <path d="M57 36L57 46M57 50V52" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>`,
    overlayColor: '#f5a623',
    badgeText: '🔶 Needs Correction',
  },
};

// ── ICONS ───────────────────────────────────────────────────────
const SOUND_ON_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const SOUND_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

// ── BROWSER NOTIFICATION PERMISSION ────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
function sendBrowserNotification(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    const n = new Notification(title, {
      body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">🦴</text></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">⚠️</text></svg>',
      requireInteraction: true,   // stays until user interacts
      tag: 'backhurts-posture',   // replaces previous notif instead of stacking
    });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

// ── PRIORITY ALERT (all layers at once) ─────────────────────────
function showPriorityAlert(cls, durationSec) {
  if (Date.now() < snoozedUntil) return;   // respect snooze

  const msg = cls === 'bad'
    ? `You've been in bad posture for ${durationSec}s — sit up straight!`
    : `Posture needs improvement for ${durationSec}s — adjust your position!`;

  // 1. OS / Browser notification (works even when tab is minimised)
  sendBrowserNotification('🚨 BackHurts — Posture Alert!', msg);

  // 2. Persistent top warning bar
  warningBarText.textContent = `⚠️ ${cls === 'bad' ? 'BAD POSTURE' : 'NEEDS IMPROVEMENT'} — ${msg}`;
  warningBar.classList.add('show');

  // 3. Full-screen priority overlay
  badOverlay.classList.add('show');

  // 4. Sound
  playBeep();

  // 5. In-app toast
  showToast('Posture Alert!', msg, 'bad', 6000);

  alertFired++;
  updateStatsDisplay();
}

// ── AUDIO ALERT ─────────────────────────────────────────────────
function playBeep() {
  if (isMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain= ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch(e) {}
}

// ── TOAST ───────────────────────────────────────────────────────
function showToast(title, msg, type = 'warn', duration = 4000) {
  const icons = { good: '✅', bad: '🚨', warn: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>`;
  toastContainer.prepend(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ── HISTORY LOG ─────────────────────────────────────────────────
function addHistoryChip(cls, rawLabel, conf) {
  if (historyEmpty && historyEmpty.parentNode) historyEmpty.remove();
  const chip = document.createElement('div');
  chip.className = `history-chip ${cls}`;
  const now = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  chip.innerHTML = `
    <span class="chip-dot"></span>
    <span>${rawLabel}</span>
    <span style="color:var(--text-muted);font-size:11px">${(conf*100).toFixed(0)}%</span>
    <span class="chip-time">${time}</span>`;
  historyScroll.prepend(chip);
  // Keep max 40 chips
  const chips = historyScroll.querySelectorAll('.history-chip');
  if (chips.length > 40) chips[chips.length - 1].remove();
}

// ── STATS TIMER ─────────────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2,'0')}`;
}
function updateStatsDisplay() {
  goodTimeEl.textContent   = formatTime(goodSec);
  badTimeEl.textContent    = formatTime(badSec);
  alertCountEl.textContent = alertFired;
}

// ── UPDATE UI STATUS ─────────────────────────────────────────────
function updateStatus(cls, rawLabel, confidence) {
  const cfg = POSTURE_CONFIG[cls];

  // Status card glow
  statusCard.className = `status-card ${cls}`;
  statusIconWrap.className = `status-icon-wrap ${cls}`;
  statusIconWrap.innerHTML = cfg.icon;

  statusLabel.textContent = cfg.label;
  statusLabel.className   = `status-label ${cls}`;
  statusSub.textContent   = cfg.sub;

  const pct = (confidence * 100).toFixed(1);
  confidencePill.textContent = `${pct}%`;
  confBarFill.style.width    = `${pct}%`;

  // Overlay badge on video
  postureOverlayBadge.style.display = 'block';
  postureOverlayBadge.style.color = cfg.overlayColor;
  postureOverlayBadge.style.borderColor = cfg.overlayColor + '44';
  postureOverlayT.textContent = cfg.badgeText;
}

// ── DRAW BOUNDING BOXES ─────────────────────────────────────────
function drawBoxes(predictions, vidW, vidH) {
  overlayCanvas.width  = vidW;
  overlayCanvas.height = vidH;
  overlayCtx.clearRect(0, 0, vidW, vidH);

  predictions.forEach(pred => {
    const cls  = classifyPosture(pred.class);
    const cfg  = POSTURE_CONFIG[cls];
    const x    = pred.x - pred.width  / 2;
    const y    = pred.y - pred.height / 2;
    const w    = pred.width;
    const h    = pred.height;

    // Box
    overlayCtx.strokeStyle = cfg.overlayColor;
    overlayCtx.lineWidth   = 2.5;
    overlayCtx.shadowColor = cfg.overlayColor;
    overlayCtx.shadowBlur  = 10;
    overlayCtx.strokeRect(x, y, w, h);
    overlayCtx.shadowBlur  = 0;

    // Label background
    const label = `ID:${pred.class} — ${(pred.confidence*100).toFixed(0)}%`;
    overlayCtx.font = 'bold 13px Inter, sans-serif';
    const tw = overlayCtx.measureText(label).width;
    overlayCtx.fillStyle = cfg.overlayColor + 'cc';
    overlayCtx.fillRect(x - 1, y - 24, tw + 12, 22);

    // Label text
    overlayCtx.fillStyle = '#fff';
    overlayCtx.fillText(label, x + 5, y - 7);
  });
}

// ── ROBOFLOW INFERENCE ──────────────────────────────────────────
async function runInference() {
  if (!isRunning || video.readyState < 2) return;

  const now = performance.now();

  // Capture frame — resize to max 640px wide for faster, more stable API calls
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const MAX_W = 640;
  const scale = vw > MAX_W ? MAX_W / vw : 1.0;
  const iw = Math.round(vw * scale);
  const ih = Math.round(vh * scale);

  inferCanvas.width  = iw;
  inferCanvas.height = ih;
  inferCtx.drawImage(video, 0, 0, iw, ih);

  const base64 = inferCanvas.toDataURL('image/jpeg', 0.82).split(',')[1];

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: base64,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Debug: always log what the model actually returns
    console.log('[BackHurts] Raw API response:', JSON.stringify(data, null, 2));

    // ── Parse result ──────────────────────────────────
    let topClass = null, topConf = 0;

    // Object detection response: data.predictions (array)
    if (Array.isArray(data.predictions) && data.predictions.length > 0) {
      // Pick highest confidence
      const best = data.predictions.reduce((a,b) => a.confidence > b.confidence ? a : b);
      topClass = best.class;
      topConf  = best.confidence;
      // Scale boxes back up to original video dimensions for the overlay
      const scaledPreds = data.predictions.map(p => ({
        ...p,
        x:      p.x      / scale,
        y:      p.y      / scale,
        width:  p.width  / scale,
        height: p.height / scale,
      }));
      drawBoxes(scaledPreds, vw, vh);
    }
    // Classification response: data.top + data.confidence OR data.predictions as object
    else if (data.top) {
      topClass = data.top;
      topConf  = data.confidence || 0;
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    // Predictions as object/array for classification
    else if (data.predictions && !Array.isArray(data.predictions)) {
      const entries = Object.entries(data.predictions);
      if (entries.length > 0) {
        const best = entries.reduce((a,b) => a[1] > b[1] ? a : b);
        topClass = best[0];
        topConf  = best[1];
      }
    }

    const minConf = parseInt(minConfidenceEl.value) / 100;
    if (topClass && topConf >= minConf) {
      // Classify posture from model result
      const cls = classifyPosture(topClass);
      const friendlyLabel = POSTURE_CONFIG[cls].label;
      console.log(`[BackHurts] Detected: "${topClass}" → classified as "${cls}" (conf: ${(topConf*100).toFixed(1)}%)`);
      updateStatus(cls, friendlyLabel, topConf);
      addHistoryChip(cls, friendlyLabel, topConf);

      // --- DETECTION FEEDBACK ---
      const confPct = topConf * 100;
      if (cls === 'good') {
        statusSub.textContent = `Great! ${confPct.toFixed(0)}% confident you are sitting straight.`;
      } else if (cls === 'warn') {
        statusSub.textContent = `Needs Correction (${confPct.toFixed(0)}%). Please adjust your back.`;
      } else {
        statusSub.textContent = `Bad Posture detected (${confPct.toFixed(0)}%). Please sit up!`;
      }

      // Stats tracking
      lastPostureClass = cls;
      if (cls === 'good') { goodSec++; consecutiveBadSec = 0; }
      else                { badSec++;  consecutiveBadSec++; }

      // Alert logic
      const alertDelay = parseInt(alertDelayEl.value);
      if (consecutiveBadSec >= alertDelay && consecutiveBadSec % alertDelay === 0) {
        showPriorityAlert(cls, consecutiveBadSec);
      }
    } else if (topClass && topConf < minConf) {
      statusSub.textContent = `Low confidence (${(topConf*100).toFixed(0)}%) — adjust camera angle`;
    }

    updateStatsDisplay();

    // FPS
    fpsFrames++;
    const elapsed = (Date.now() - fpsTime) / 1000;
    if (elapsed >= 1) {
      fpsCounter.textContent = `${Math.round(fpsFrames / elapsed)} fps`;
      fpsFrames = 0;
      fpsTime   = Date.now();
    }

  } catch(err) {
    console.warn('Inference error:', err);
    showToast('API Error', err.message, 'warn', 4000);
  }
}

// ── START MONITOR ───────────────────────────────────────────────
async function startMonitor() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();

    isRunning = true;
    video.style.display = 'block';
    cameraIdle.style.display = 'none';
    scanLine.style.display = 'block';
    postureOverlay.style.display = 'block';
    overlayCanvas.style.display = 'block';

    liveBadge.classList.add('active');
    liveText.textContent = 'LIVE';

    startBtn.disabled    = true;
    stopBtn.disabled     = false;
    snapshotBtn.disabled = false;

    showToast('Monitor Started', 'Camera is active. Detecting posture…', 'info', 3000);

    // Detection loop using interval
    const interval = parseInt(detectIntervalEl.value);
    detectLoop = setInterval(runInference, interval);

    // Stats ticker — counts actual seconds spent in each posture
    statsLoop = setInterval(() => {
      if (lastPostureClass === 'good') {
        goodSec++;
      } else if (lastPostureClass === 'bad' || lastPostureClass === 'warn') {
        badSec++;
        consecutiveBadSec++;
      }
      updateStatsDisplay();
    }, 1000);

  } catch(err) {
    showToast('Camera Error', err.message || 'Could not access webcam.', 'bad', 6000);
  }
}

// ── STOP MONITOR ────────────────────────────────────────────────
function stopMonitor() {
  isRunning = false;
  clearInterval(detectLoop);
  clearInterval(statsLoop);

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  video.style.display = 'none';
  cameraIdle.style.display = 'flex';
  scanLine.style.display = 'none';
  postureOverlay.style.display = 'none';
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  liveBadge.classList.remove('active');
  liveText.textContent = 'OFFLINE';
  fpsCounter.textContent = '-- fps';

  startBtn.disabled    = false;
  stopBtn.disabled     = true;
  snapshotBtn.disabled = true;

  statusCard.className  = 'status-card';
  statusLabel.textContent = 'Waiting…';
  statusSub.textContent   = 'Start the monitor to detect posture';
  confidencePill.textContent = '--.--% ';
  confBarFill.style.width = '0%';

  showToast('Monitor Stopped', 'Session ended.', 'info', 3000);
}

// ── SNAPSHOT ────────────────────────────────────────────────────
function takeSnapshot() {
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  // Draw overlay too
  ctx.drawImage(overlayCanvas, 0, 0);
  const a = document.createElement('a');
  a.href     = canvas.toDataURL('image/png');
  a.download = `backhurts_${Date.now()}.png`;
  a.click();
  showToast('Snapshot Saved', 'Image downloaded successfully.', 'good', 3000);
}

// ── RESET STATS ─────────────────────────────────────────────────
function resetStats() {
  goodSec = badSec = alertFired = consecutiveBadSec = 0;
  updateStatsDisplay();
  showToast('Stats Reset', 'Session stats have been cleared.', 'info', 2000);
}

// ── SETTINGS SLIDERS ────────────────────────────────────────────
alertDelayEl.addEventListener('input', () => {
  alertDelayVal.textContent = `${alertDelayEl.value}s`;
});
detectIntervalEl.addEventListener('input', () => {
  const v = parseInt(detectIntervalEl.value);
  detectIntervalV.textContent = `${(v/1000).toFixed(1)}s`;
  if (isRunning) {
    clearInterval(detectLoop);
    detectLoop = setInterval(runInference, v);
  }
});
minConfidenceEl.addEventListener('input', () => {
  minConfidenceV.textContent = `${minConfidenceEl.value}%`;
});

// ── SOUND TOGGLE ────────────────────────────────────────────────
soundToggle.addEventListener('click', () => {
  isMuted = !isMuted;
  soundToggle.innerHTML = isMuted ? SOUND_OFF_SVG : SOUND_ON_SVG;
  soundToggle.setAttribute('title', isMuted ? 'Unmute alerts' : 'Mute alerts');
});

// ── BUTTON BINDINGS ─────────────────────────────────────────────
startBtn.addEventListener('click', startMonitor);
stopBtn.addEventListener('click', stopMonitor);
snapshotBtn.addEventListener('click', takeSnapshot);
resetStatsBtn.addEventListener('click', resetStats);

// Dismiss overlay + bar
dismissOverlay.addEventListener('click', () => {
  badOverlay.classList.remove('show');
  warningBar.classList.remove('show');
});

// Snooze 2 minutes
snoozeOverlayBtn.addEventListener('click', () => {
  snoozedUntil = Date.now() + 2 * 60 * 1000;
  badOverlay.classList.remove('show');
  warningBar.classList.remove('show');
  showToast('Snoozed', 'Alerts snoozed for 2 minutes.', 'info', 3000);
});

// Dismiss just the bar
dismissWarningBarBtn.addEventListener('click', () => warningBar.classList.remove('show'));

clearLogBtn.addEventListener('click', () => {
  historyScroll.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'history-empty';
  empty.id = 'historyEmpty';
  empty.textContent = 'No detections yet — start the monitor above';
  historyScroll.appendChild(empty);
});

// Close bad overlay on backdrop click
badOverlay.addEventListener('click', (e) => {
  if (e.target === badOverlay) {
    badOverlay.classList.remove('show');
    warningBar.classList.remove('show');
  }
});

// ── INIT ─────────────────────────────────────────────────────────
updateStatsDisplay();
console.log('🦴 BackHurts initialised — Roboflow model:', MODEL_ID);
