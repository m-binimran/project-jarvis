/**
 * voice.js — "Hey Jarvis" hands-free voice input for the talk box.
 *
 * WHY THIS EXISTS: Electron's bundled Chromium has no Google speech key, so the
 * usual `webkitSpeechRecognition` just silently fails — that's why talking to
 * JARVIS never worked. Here we do speech-to-text fully OFFLINE with Vosk (WASM):
 * no API key, no cloud, works on a plane, free forever.
 *
 * FLOW: always-listen for the wake word "jarvis" → then capture the next
 * sentence as a command → hand it to the talk box. If the mic or model isn't
 * available it degrades to plain typing and shows why — it never throws into UI.
 *
 * MODEL: a ~40 MB Vosk small-English model served locally at MODEL_URL.
 * Run setup-voice.ps1 once to download it; until then the status bar says so.
 *
 * RAM NOTE: the model is loaded only while the mic is ON and fully released when
 * it's OFF, so it costs nothing on weak machines until you actually use it.
 */

const VOSK_ESM   = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/+esm";
const MODEL_URL  = "/models/vosk-model-small-en-us-0.15.tar.gz";
const WAKE       = /\b(?:hey |ok |okay |hi )?jarvis\b/i;
const SAMPLE_RATE = 16000;

// Public state the talk box can read at any time.
export const voice = { available: false, listening: false, awake: false, muted: false };

let model = null, recognizer = null, audioCtx = null, micNode = null, source = null, sink = null, stream = null;
let cb = { status: () => {}, partial: () => {}, command: () => {} };

// Push-to-talk (orb mic / hold-space): capture while held, no wake word needed.
let ptt = { active: false, finals: "", partial: "", onPartial: null };

/** Register UI callbacks: { status(state, text), partial(text), command(text) }. */
export function onVoice(handlers) { cb = { ...cb, ...handlers }; }

/** Ignore mic input while true — used so JARVIS doesn't hear its own spoken reply. */
export function setMuted(m) { voice.muted = !!m; }

function status(state, text) { try { cb.status(state, text); } catch (_) {} }

// ── Engine (Vosk model) ─────────────────────────────────────────────────────
async function ensureEngine() {
  if (recognizer) return true;
  status("load", "Loading voice model…");

  let Vosk;
  try { Vosk = await import(/* @vite-ignore */ VOSK_ESM); }
  catch (_) { status("error", "Voice library couldn't load (are you offline?)."); return false; }

  const createModel = Vosk.createModel || (Vosk.default && Vosk.default.createModel);
  if (typeof createModel !== "function") { status("error", "Voice library is malformed."); return false; }

  // Is the model file actually installed? (setup-voice.ps1 downloads it.)
  try {
    const head = await fetch(MODEL_URL, { method: "HEAD" });
    if (!head.ok) { status("setup", "Voice model not installed — run setup-voice.ps1, then retry."); return false; }
  } catch (_) { /* some servers reject HEAD; let createModel try the GET anyway */ }

  try {
    model = await createModel(MODEL_URL);
    recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
    recognizer.setWords(true);
    recognizer.on("result", (m) => {
      const t = (m && m.result && m.result.text) || "";
      if (ptt.active) { if (t) ptt.finals += (ptt.finals ? " " : "") + t; return; }
      handleFinal(t);
    });
    recognizer.on("partialresult", (m) => {
      const p = (m && m.result && m.result.partial) || "";
      if (ptt.active) { ptt.partial = p; if (ptt.onPartial) ptt.onPartial(p); return; }
      cb.partial(p);
    });
    return true;
  } catch (e) {
    status("error", "Couldn't start the voice model (" + (e && e.message || e) + ").");
    model = null; recognizer = null;
    return false;
  }
}

// ── Microphone ───────────────────────────────────────────────────────────────
async function startMic() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  try { audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE }); }
  catch (_) { audioCtx = new AudioContext(); } // some platforms reject custom rates; Vosk resamples

  source  = audioCtx.createMediaStreamSource(stream);
  micNode = audioCtx.createScriptProcessor(4096, 1, 1);
  micNode.onaudioprocess = (e) => {
    if (voice.muted || !recognizer) return;
    try { recognizer.acceptWaveform(e.inputBuffer); } catch (_) {}
  };
  // Route through a silent gain node so the mic is NOT echoed back to the speakers.
  sink = audioCtx.createGain();
  sink.gain.value = 0;
  source.connect(micNode); micNode.connect(sink); sink.connect(audioCtx.destination);
}

// ── Public start / stop ──────────────────────────────────────────────────────
export async function start() {
  if (voice.listening) return;
  if (!(await ensureEngine())) return;
  try { await startMic(); }
  catch (e) { status("error", "No microphone access (" + (e && e.message || e) + ")."); return; }
  voice.available = true; voice.listening = true; voice.awake = false;
  status("idle", "Listening for “Hey Jarvis”…");
}

export function stop() {
  voice.listening = false; voice.awake = false;
  try { if (micNode) micNode.onaudioprocess = null; } catch (_) {}
  try { if (source) source.disconnect(); if (micNode) micNode.disconnect(); if (sink) sink.disconnect(); } catch (_) {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { if (audioCtx) audioCtx.close(); } catch (_) {}
  // Release the model too, so we give the RAM back on weak machines.
  try { if (model && model.terminate) model.terminate(); } catch (_) {}
  audioCtx = source = micNode = sink = stream = null;
  model = null; recognizer = null;
  status("off", "Voice off.");
}

/** Push-to-talk: start capturing now (no wake word). onPartial(text) gives a live caption.
 *  Loads the model on first use, then stays warm so later presses are instant. */
export async function pttStart(onPartial) {
  if (!(await ensureEngine())) return false;
  if (!audioCtx) { try { await startMic(); } catch (e) { status("error", "No microphone (" + (e && e.message || e) + ")."); return false; } }
  voice.listening = true; voice.muted = false;
  ptt = { active: true, finals: "", partial: "", onPartial: onPartial || null };
  status("listening", "Listening…");
  return true;
}

/** Stop push-to-talk and return the captured text. Keeps the engine warm for the next press. */
export function pttStop() {
  const text = (ptt.finals + " " + ptt.partial).trim();
  ptt = { active: false, finals: "", partial: "", onPartial: null };
  voice.muted = true; // stop feeding audio but keep mic + model warm
  return text;
}

// ── Wake word + command logic ────────────────────────────────────────────────
function handleFinal(text) {
  const t = (text || "").trim();
  if (!t || voice.muted) return;

  if (!voice.awake) {
    const m = WAKE.exec(t);
    if (!m) return;                               // still waiting for "...jarvis..."
    const after = t.slice(m.index + m[0].length).trim();
    if (after.length >= 2) dispatch(after);       // "hey jarvis what's the time" — all in one breath
    else { voice.awake = true; status("awake", "Yes? I'm listening…"); }
    return;
  }
  // Awake: this whole sentence is the command.
  if (t.length >= 2) dispatch(t);
}

function dispatch(command) {
  voice.awake = false;
  status("idle", "Listening for “Hey Jarvis”…");
  try { cb.command(command); } catch (_) {}
}
