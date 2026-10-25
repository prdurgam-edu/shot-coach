// Shot Coach: camera, detection, coaching loop, burst capture and gallery.
import { analyze, bodyFromLandmarks, scoreShot, ISSUE_ORDER, BLOCKING, AUDIENCE, LANGS, TEXT } from './coach.js';

// ---------------------------------------------------------------- configuration

const VISION_VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
// For venues with poor data: put these files next to index.html (see README) and the app uses them instead.
const LOCAL_LIB = './lib/vision_bundle.mjs';
const LOCAL_WASM = './lib/wasm';
const MODELS = {
  face: {
    local: './models/face_landmarker.task',
    remote: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  pose: {
    local: './models/pose_landmarker_lite.task',
    remote: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
};

const TICK_MS = 90; // analysis interval
const PERSIST_TICKS = 4; // an issue must last this long before it is announced
const HOLD_TICKS = 9; // everything fine and steady for this long, then auto-capture
const BURST_FRAMES = 6;
const BURST_GAP_MS = 120;
const SPEAK_GAP_MS = 3200; // minimum time between two prompts
const REPEAT_MS = 9000; // the same prompt is repeated at most this often
const AFTER_SHOT_MS = 8000; // pause auto-capture after a photo

const READY = { en: 'Camera ready.', hi: 'कैमरा तैयार है।', te: 'కెమెరా సిద్ధంగా ఉంది.' };
const WHO = {
  en: { you: 'For you', group: 'For the group' },
  hi: { you: 'आपके लिए', group: 'ग्रुप के लिए' },
  te: { you: 'మీ కోసం', group: 'గ్రూప్ కోసం' },
};

// ---------------------------------------------------------------- state and elements

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), overlay: $('overlay'), viewport: $('viewport'), banner: $('banner'), hold: $('hold'),
  flash: $('flash'), status: $('status'), shutter: $('shutter'), thumb: $('thumb'), flip: $('flip'),
  voiceBtn: $('voiceBtn'), autoBtn: $('autoBtn'), settingsBtn: $('settingsBtn'),
  setup: $('setup'), startBtn: $('startBtn'), setupError: $('setupError'), voiceNote: $('voiceNote'),
  askSmile: $('askSmile'), gallery: $('gallery'), grid: $('grid'), closeGallery: $('closeGallery'),
};

const state = {
  lang: 'en', subjects: 'group', framing: 'upper', askSmile: true, voice: true, auto: true,
  facing: 'environment', running: false,
};
const STORE_KEY = 'shotcoach.v1';
const SAVED = ['lang', 'subjects', 'framing', 'askSmile', 'voice', 'auto'];

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    for (const k of SAVED) if (k in raw) state[k] = raw[k];
  } catch { /* storage unavailable: use defaults */ }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]])))); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- settings UI

function radio(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function applyToForm() {
  for (const name of ['lang', 'subjects', 'framing']) {
    const el = document.querySelector(`input[name="${name}"][value="${state[name]}"]`);
    if (el) el.checked = true;
  }
  els.askSmile.checked = state.askSmile;
  refreshButtons();
}
function readForm() {
  state.lang = radio('lang') || state.lang;
  state.subjects = radio('subjects') || state.subjects;
  state.framing = radio('framing') || state.framing;
  state.askSmile = els.askSmile.checked;
  saveSettings();
}
function refreshButtons() {
  els.voiceBtn.setAttribute('aria-pressed', String(state.voice));
  els.autoBtn.setAttribute('aria-pressed', String(state.auto));
  if (!state.auto) els.hold.hidden = true;
}
function setStatus(t) { els.status.textContent = t; }
function showError(msg) { els.setupError.textContent = msg; els.setupError.hidden = !msg; }

// ---------------------------------------------------------------- voice

let voices = [];
function refreshVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; updateVoiceNote(); }
const norm = (l) => String(l || '').toLowerCase().replace('_', '-');
function pickVoice(lang) {
  const cfg = LANGS[lang];
  for (const want of [cfg.speech, ...cfg.fallbackSpeech].map(norm)) {
    const exact = voices.find((v) => norm(v.lang) === want);
    if (exact) return exact;
    if (!want.includes('-')) {
      const loose = voices.find((v) => norm(v.lang).split('-')[0] === want);
      if (loose) return loose;
    }
  }
  return null;
}
function updateVoiceNote() {
  const lang = radio('lang') || state.lang;
  const label = LANGS[lang].label;
  const has = !!pickVoice(lang);
  els.voiceNote.classList.toggle('warn', !has);
  els.voiceNote.textContent = has
    ? `A ${label} voice is available on this phone.`
    : `No ${label} voice found on this phone yet. Prompts will show on screen. You can add a voice in the phone's text-to-speech settings.`;
}
let lastSpokenAt = 0;
function speak(text) {
  if (!state.voice || !window.speechSynthesis) return false;
  const voice = pickVoice(state.lang);
  if (!voice && state.lang !== 'en') return false; // no voice for this language: on-screen only
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : LANGS[state.lang].speech;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
    lastSpokenAt = performance.now();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- camera

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.running) keepAwake(); });

function stopCamera() {
  const s = els.video.srcObject;
  if (s) s.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null;
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
  stopCamera();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  els.video.srcObject = stream;
  els.video.classList.toggle('mirror', state.facing === 'user');
  await els.video.play();
  if (!els.video.videoWidth) await new Promise((r) => els.video.addEventListener('loadedmetadata', r, { once: true }));
}

// ---------------------------------------------------------------- detectors (MediaPipe)

let vision = null;
let wasmBase = CDN + '/wasm';
let fileset = null;
let faceLM = null;
let poseLM = null;

async function loadVision() {
  if (vision) return vision;
  try {
    vision = await import(LOCAL_LIB);
    wasmBase = LOCAL_WASM;
  } catch {
    vision = await import(`${CDN}/vision_bundle.mjs`);
    wasmBase = CDN + '/wasm';
  }
  return vision;
}
async function pickModel(m) {
  try {
    const r = await fetch(m.local, { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    if (r.ok && !type.includes('text/html')) return m.local;
  } catch { /* not bundled */ }
  return m.remote;
}
async function createLandmarker(Cls, model, extra) {
  const modelAssetPath = await pickModel(model);
  let last;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', ...extra });
    } catch (e) { last = e; }
  }
  throw last;
}
async function ensureDetectors() {
  const v = await loadVision();
  if (!fileset) fileset = await v.FilesetResolver.forVisionTasks(wasmBase);
  if (!faceLM) {
    setStatus('Loading face model');
    faceLM = await createLandmarker(v.FaceLandmarker, MODELS.face, { numFaces: 8, outputFaceBlendshapes: true });
  }
  if (state.framing === 'full' && !poseLM) {
    setStatus('Loading body model');
    poseLM = await createLandmarker(v.PoseLandmarker, MODELS.pose, { numPoses: 8 });
  }
}

// ---------------------------------------------------------------- frame building

function toFrame(faceRes, poseRes) {
  const mirror = state.facing === 'user';
  const faces = (faceRes.faceLandmarks || []).map((lm, i) => {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (mirror) [minX, maxX] = [1 - maxX, 1 - minX]; // match what the person sees on screen
    const cats = faceRes.faceBlendshapes?.[i]?.categories || [];
    const g = (n) => cats.find((c) => c.categoryName === n)?.score ?? 0;
    const h = maxY - minY;
    return {
      minX, maxX, maxY,
      minY: Math.max(0, minY - 0.3 * h), // the mesh stops at the forehead; add room for hair
      box: { minX, maxX, minY, maxY },
      blink: (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2,
      smile: (g('mouthSmileLeft') + g('mouthSmileRight')) / 2,
    };
  });
  const bodies = (poseRes?.landmarks || []).map(bodyFromLandmarks);
  return { faces, bodies };
}

// ---------------------------------------------------------------- overlay drawing

const ctx = els.overlay.getContext('2d');
let dpr = 1;
function layoutCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = els.viewport.clientWidth, h = els.viewport.clientHeight;
  els.overlay.width = Math.round(w * dpr);
  els.overlay.height = Math.round(h * dpr);
}
new ResizeObserver(layoutCanvas).observe(els.viewport);

function videoRect() {
  const W = els.viewport.clientWidth, H = els.viewport.clientHeight;
  const vw = els.video.videoWidth || 16, vh = els.video.videoHeight || 9;
  const s = Math.min(W / vw, H / vh);
  const dw = vw * s, dh = vh * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh };
}
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function draw(faces, blocked) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, els.viewport.clientWidth, els.viewport.clientHeight);
  const { ox, oy, dw, dh } = videoRect();
  // rule-of-thirds guide
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    ctx.moveTo(ox + (dw * i) / 3, oy); ctx.lineTo(ox + (dw * i) / 3, oy + dh);
    ctx.moveTo(ox, oy + (dh * i) / 3); ctx.lineTo(ox + dw, oy + (dh * i) / 3);
  }
  ctx.stroke();
  const color = blocked ? '#f3a712' : '#6fd3a4';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  for (const f of faces) {
    const b = f.box;
    rrect(ox + b.minX * dw, oy + b.minY * dh, (b.maxX - b.minX) * dw, (b.maxY - b.minY) * dh, 10);
    ctx.stroke();
  }
  if (faces.length > 1) {
    const x0 = Math.min(...faces.map((f) => f.minX)), x1 = Math.max(...faces.map((f) => f.maxX));
    const y0 = Math.min(...faces.map((f) => f.minY)), y1 = Math.max(...faces.map((f) => f.maxY));
    ctx.setLineDash([8, 6]);
    ctx.globalAlpha = 0.7;
    rrect(ox + x0 * dw - 8, oy + y0 * dh - 8, (x1 - x0) * dw + 16, (y1 - y0) * dh + 16, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- coaching loop

const counts = {};
const history = [];
let readyStreak = 0;
let holdSpoken = false;
let lastKey = null;
let lastKeyAt = 0;
let lastShotAt = 0;
let capturing = false;
let lastFrame = null;
let rafId = 0;
let lastTick = 0;
let lastVideoTime = -1;

function resetCoach() {
  for (const k of Object.keys(counts)) counts[k] = 0;
  history.length = 0;
  readyStreak = 0; holdSpoken = false; lastKey = null;
}

function isSteady() {
  if (history.length < 8) return false;
  const xs = history.map((h) => h.cx), ws = history.map((h) => h.width);
  return Math.max(...xs) - Math.min(...xs) < 0.02 && Math.max(...ws) - Math.min(...ws) < 0.03;
}

function showBanner(kind, who, msg) {
  els.banner.hidden = false;
  els.banner.classList.toggle('good', kind === 'good');
  els.banner.querySelector('.who').textContent = who;
  els.banner.querySelector('.msg').textContent = msg;
}

function onTick(now) {
  const ts = performance.now();
  let faceRes, poseRes = null;
  try {
    faceRes = faceLM.detectForVideo(els.video, ts);
    if (state.framing === 'full' && poseLM) poseRes = poseLM.detectForVideo(els.video, ts + 0.01);
  } catch (e) { console.error(e); return; }

  const frame = toFrame(faceRes, poseRes);
  lastFrame = frame;
  const { issues, stats } = analyze(frame, { subjects: state.subjects, framing: state.framing, askSmile: state.askSmile });

  const present = new Set(issues);
  for (const k of ISSUE_ORDER) counts[k] = present.has(k) ? (counts[k] || 0) + 1 : 0;
  const stable = ISSUE_ORDER.filter((k) => counts[k] >= PERSIST_TICKS);
  const top = stable[0] || null;

  const blocked = issues.some((k) => BLOCKING.has(k));
  readyStreak = blocked ? 0 : readyStreak + 1;
  if (stats.count) { history.push({ cx: stats.cx, width: stats.width }); if (history.length > 8) history.shift(); } else history.length = 0;
  if (blocked) holdSpoken = false;

  draw(frame.faces, blocked);
  setStatus(stats.count ? `${stats.count} ${stats.count === 1 ? 'face' : 'faces'} found` : 'Looking for people');

  const text = TEXT[state.lang];
  const who = WHO[state.lang];
  if (top) {
    showBanner('issue', who[AUDIENCE[top]], text[top]);
    const repeat = top !== lastKey || now - lastKeyAt > REPEAT_MS;
    const quiet = now - lastSpokenAt > SPEAK_GAP_MS && !(window.speechSynthesis && speechSynthesis.speaking);
    if (repeat && quiet) { speak(text[top]); lastKey = top; lastKeyAt = now; }
  } else if (readyStreak >= 3) {
    showBanner('good', who.you, text.hold);
    if (!holdSpoken && state.auto) { holdSpoken = true; speak(text.hold); }
  } else if (stats.count) {
    showBanner('good', who.you, text.looking);
  } else {
    els.banner.hidden = true;
  }

  const holding = state.auto && readyStreak > 0 && !capturing;
  els.hold.hidden = !holding;
  if (holding) els.hold.firstElementChild.style.width = `${Math.min(100, (readyStreak / HOLD_TICKS) * 100)}%`;

  if (state.auto && !capturing && readyStreak >= HOLD_TICKS && isSteady() && now - lastShotAt > AFTER_SHOT_MS) {
    capture(BURST_FRAMES);
  }
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (!state.running || document.hidden || !faceLM) return;
  if (now - lastTick < TICK_MS) return;
  if (els.video.readyState < 2 || els.video.currentTime === lastVideoTime) return;
  lastTick = now;
  lastVideoTime = els.video.currentTime;
  onTick(now);
}

// ---------------------------------------------------------------- capture

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = [document.createElement('canvas'), document.createElement('canvas')];
const probe = document.createElement('canvas');

function sharpness(src) {
  const w = 320, h = Math.max(1, Math.round((w * src.height) / src.width));
  probe.width = w; probe.height = h;
  const g = probe.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

function renderFrame(c) {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  c.width = vw; c.height = vh;
  const g = c.getContext('2d');
  if (state.facing === 'user') { g.translate(vw, 0); g.scale(-1, 1); } // keep the saved photo like the preview
  g.drawImage(els.video, 0, 0, vw, vh);
}

const photos = [];
async function capture(frames) {
  if (capturing || !state.running) return;
  capturing = true;
  els.shutter.disabled = true;
  els.hold.hidden = true;
  try {
    let bestIdx = -1, bestScore = -Infinity;
    for (let i = 0; i < frames; i++) {
      const idx = bestIdx === 0 ? 1 : 0;
      renderFrame(pool[idx]);
      const score = scoreShot({ sharpness: frames > 1 ? sharpness(pool[idx]) : 100, faces: lastFrame ? lastFrame.faces : [] });
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
      if (i < frames - 1) await sleep(BURST_GAP_MS);
    }
    const blob = await new Promise((r) => pool[bestIdx].toBlob(r, 'image/jpeg', 0.92));
    if (blob) addPhoto(blob);
    els.flash.classList.remove('go');
    void els.flash.offsetWidth; // restart the animation
    els.flash.classList.add('go');
    speak(TEXT[state.lang].captured);
  } catch (e) {
    console.error(e);
  } finally {
    lastShotAt = performance.now();
    capturing = false;
    els.shutter.disabled = !state.running;
    readyStreak = 0; holdSpoken = false;
  }
}

function addPhoto(blob) {
  const url = URL.createObjectURL(blob);
  const n = photos.length + 1;
  photos.push({ blob, url, name: `shot-${String(n).padStart(3, '0')}.jpg` });
  els.thumb.hidden = false;
  els.thumb.style.backgroundImage = `url("${url}")`;
  els.thumb.querySelector('span').textContent = String(photos.length);
}

function openGallery() {
  els.grid.replaceChildren();
  for (const p of [...photos].reverse()) {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = p.url; img.alt = p.name;
    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('a');
    save.href = p.url; save.download = p.name; save.textContent = 'Save';
    row.append(save);
    const file = new File([p.blob], p.name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const share = document.createElement('button');
      share.textContent = 'Share';
      share.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
      row.append(share);
    }
    fig.append(img, row);
    els.grid.append(fig);
  }
  els.gallery.hidden = false;
}

// ---------------------------------------------------------------- start, settings, controls

function explain(e) {
  const name = e && e.name;
  if (name === 'InsecureContext') return 'The camera only works on a secure (https) address. Open this app from its https link, not from a file on the phone.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return "Camera access was blocked. Allow the camera for this site in the browser's site settings, then tap Start camera again.";
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  return 'Could not start. ' + (e && e.message ? e.message : 'Check your internet connection and try again.');
}

let started = false;
async function onStart() {
  readForm();
  showError('');
  els.startBtn.disabled = true;
  if (!started) speak(READY[state.lang]); // inside the tap, so phones allow speech afterwards
  try {
    if (!started) {
      els.startBtn.textContent = 'Starting…';
      await startCamera();
      await ensureDetectors();
      started = true;
      state.running = true;
      els.shutter.disabled = false;
      keepAwake();
      layoutCanvas();
    } else {
      await ensureDetectors(); // loads the body model when Full length was just chosen
    }
    resetCoach();
    els.setup.hidden = true;
    els.startBtn.textContent = 'Done';
    setStatus('Looking for people');
  } catch (e) {
    console.error(e);
    stopCamera();
    started = false; state.running = false;
    showError(explain(e));
    els.startBtn.textContent = 'Start camera';
  } finally {
    els.startBtn.disabled = false;
  }
}

els.startBtn.addEventListener('click', onStart);
els.settingsBtn.addEventListener('click', () => { applyToForm(); updateVoiceNote(); els.setup.hidden = false; });
els.setup.addEventListener('change', (e) => { if (e.target.name === 'lang') updateVoiceNote(); });
els.voiceBtn.addEventListener('click', () => {
  state.voice = !state.voice;
  if (!state.voice && window.speechSynthesis) speechSynthesis.cancel();
  saveSettings(); refreshButtons();
});
els.autoBtn.addEventListener('click', () => { state.auto = !state.auto; saveSettings(); refreshButtons(); });
els.shutter.addEventListener('click', () => capture(1));
els.thumb.addEventListener('click', openGallery);
els.closeGallery.addEventListener('click', () => { els.gallery.hidden = true; });
els.flip.addEventListener('click', async () => {
  if (!state.running) return;
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  try { await startCamera(); resetCoach(); } catch (e) { console.error(e); state.facing = state.facing === 'user' ? 'environment' : 'user'; }
});

if (window.speechSynthesis) {
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  refreshVoices();
}
loadSettings();
applyToForm();
updateVoiceNote();
layoutCanvas();
rafId = requestAnimationFrame(loop);
