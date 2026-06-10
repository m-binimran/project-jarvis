/**
 * JARVIS Voice Layer
 *
 * Wake word: "Jarvis" — continuous listening via Web Speech API
 *            (built into Electron's Chromium, zero native deps, works on Windows)
 *
 * TTS: Web Speech API SpeechSynthesis for instant response
 *      Falls back to Edge TTS (higher quality) when available via daemon
 *
 * Decision 22: Voice IS the experience. "Jarvis" → listens → responds spoken.
 */

const WAKE_WORDS = ["jarvis", "hey jarvis", "ok jarvis"];
const DAEMON_URL = "http://127.0.0.1:9101";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceState =
  | "idle"          // listening for wake word silently
  | "wake"          // wake word detected, showing indicator
  | "listening"     // capturing user command
  | "processing"    // sending to JARVIS
  | "speaking"      // reading response aloud
  | "error";        // mic access denied or API error

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (text: string, final: boolean) => void;
  onResponse: (text: string) => void;
  onError: (msg: string) => void;
}

// ─── Voice engine ─────────────────────────────────────────────────────────────

export class VoiceEngine {
  private recognition: SpeechRecognition | null = null;
  private state: VoiceState = "idle";
  private callbacks: VoiceCallbacks;
  private enabled = false;
  private commandBuffer = "";
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onSendMessage?: (text: string) => void;

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;
  }

  /** Wire in the chat send function so voice commands go through normal chat */
  setSendHandler(fn: (text: string) => void) {
    this.onSendMessage = fn;
  }

  private setState(s: VoiceState) {
    this.state = s;
    this.callbacks.onStateChange(s);
  }

  private hasRecognitionSupport(): boolean {
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }

  start(): boolean {
    if (!this.hasRecognitionSupport()) {
      this.callbacks.onError("Speech recognition not supported in this browser/environment");
      return false;
    }

    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    this.recognition = new SR() as SpeechRecognition;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.handleResult(event);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech") {
        // Normal — just restart
        this.restartRecognition();
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.setState("error");
        this.callbacks.onError("Microphone access denied. Enable microphone in system settings.");
        return;
      }
      // Other errors — restart
      this.restartRecognition();
    };

    this.recognition.onend = () => {
      if (this.enabled && this.state !== "error") {
        this.restartRecognition();
      }
    };

    this.enabled = true;
    this.recognition.start();
    this.setState("idle");
    return true;
  }

  stop() {
    this.enabled = false;
    this.recognition?.stop();
    this.recognition = null;
    this.setState("idle");
  }

  private restartRecognition() {
    if (!this.enabled) return;
    setTimeout(() => {
      if (!this.enabled) return;
      try {
        this.recognition?.start();
      } catch {
        // Already started — ignore
      }
    }, 200);
  }

  private handleResult(event: SpeechRecognitionEvent) {
    const results = Array.from(event.results);

    if (this.state === "idle") {
      // Looking for wake word in recent speech
      const recentText = results
        .slice(-3)
        .map(r => r[0].transcript.toLowerCase().trim())
        .join(" ");

      if (WAKE_WORDS.some(w => recentText.includes(w))) {
        this.setState("wake");
        this.commandBuffer = "";
        this.speak("Yes?");

        // Short delay then switch to listening mode
        setTimeout(() => this.setState("listening"), 600);
      }
      return;
    }

    if (this.state === "listening") {
      // Accumulate command
      const lastResult = results[results.length - 1];
      const transcript = lastResult[0].transcript;
      const isFinal = lastResult.isFinal;

      this.callbacks.onTranscript(transcript, isFinal);

      if (isFinal) {
        this.commandBuffer += " " + transcript;
      }

      // Reset silence timer — send after 1.5s of silence
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        if (this.commandBuffer.trim().length > 2) {
          this.sendCommand(this.commandBuffer.trim());
        } else {
          // Too short — go back to idle
          this.setState("idle");
          this.commandBuffer = "";
        }
      }, 1500);
    }
  }

  private async sendCommand(text: string) {
    this.setState("processing");
    this.commandBuffer = "";
    this.silenceTimer = null;

    // Route through the chat send handler (same path as typed messages)
    if (this.onSendMessage) {
      this.onSendMessage(text);
    }

    // Go back to idle — response will come through the normal chat stream
    this.setState("idle");
  }

  /** Speak text aloud using Web Speech API SpeechSynthesis */
  speak(text: string): void {
    if (!("speechSynthesis" in window)) return;

    // Cancel any in-progress speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    utterance.volume = 0.9;

    // Try to find a good voice — prefer Microsoft David/Zira on Windows
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      v => v.name.includes("David") || v.name.includes("Zira") || v.name.includes("Google UK")
    );
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => this.setState("speaking");
    utterance.onend = () => {
      if (this.state === "speaking") this.setState("idle");
    };

    window.speechSynthesis.speak(utterance);
  }

  getState(): VoiceState { return this.state; }
  isEnabled(): boolean { return this.enabled; }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: VoiceEngine | null = null;

export function getVoiceEngine(callbacks?: VoiceCallbacks): VoiceEngine {
  if (!_engine && callbacks) {
    _engine = new VoiceEngine(callbacks);
  }
  return _engine!;
}

export function destroyVoiceEngine() {
  _engine?.stop();
  _engine = null;
}

// ─── State label helpers ──────────────────────────────────────────────────────

export function voiceStateLabel(state: VoiceState): string {
  switch (state) {
    case "idle":       return "Listening…";
    case "wake":       return "Wake word detected";
    case "listening":  return "Listening to command…";
    case "processing": return "Processing…";
    case "speaking":   return "Speaking…";
    case "error":      return "Mic error";
  }
}

export function voiceStateIcon(state: VoiceState): string {
  switch (state) {
    case "idle":       return "🎙";
    case "wake":       return "⚡";
    case "listening":  return "👂";
    case "processing": return "⏳";
    case "speaking":   return "🔊";
    case "error":      return "🚫";
  }
}
