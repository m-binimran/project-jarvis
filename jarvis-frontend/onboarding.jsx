// onboarding.jsx — Conversational JARVIS setup
//
// JARVIS guides the user through setup in a natural conversation.
// No forms, no checklists — just talking to JARVIS.
//
// Flow (all handled in conversation):
//   1. JARVIS introduces itself
//   2. Asks which AI provider (user types or clicks chip)
//   3. Asks for API key → saves to daemon keychain
//   4. Voice test — say "Jarvis" (skippable)
//   5. Asks for Master Vision → saves to daemon
//   6. Asks for permission mode → saves to daemon
//   7. Done — enters main app
//
// Note: Steps 1-3 are scripted (no API key yet, can't call AI).
// Steps 4-7 can optionally use real AI once the key is saved.
// For reliability, the whole flow is scripted — feels like JARVIS, works every time.

// ── Conversation state machine ───────────────────────────────────────────────
// stage values: intro | provider | apikey | key_saving | voice | vision | vision_saving | permission | done

const PROVIDERS = [
  { id: "ollama",    name: "Ollama (free)", hint: "", url: "ollama.com", keyless: true, test: () => true },
  { id: "anthropic", name: "Anthropic", hint: "sk-ant-api03-…", url: "console.anthropic.com", test: k => k.startsWith("sk-ant") },
  { id: "openai",    name: "OpenAI",    hint: "sk-proj-…",      url: "platform.openai.com/api-keys", test: k => k.startsWith("sk-") },
  { id: "google",    name: "Google",    hint: "AIzaSy…",         url: "aistudio.google.com/apikey",   test: k => k.startsWith("AIza") },
];

const PERMISSION_MODES = [
  { id: "safe",       label: "Safe",       desc: "Ask before every action" },
  { id: "productive", label: "Productive", desc: "Auto-approve low-risk, ask for changes (recommended)" },
  { id: "auto",       label: "Auto",       desc: "AI decides what needs approval" },
  { id: "bypass",     label: "Bypass",     desc: "Run freely — circuit breakers still apply" },
];

// ── Onboarding component ─────────────────────────────────────────────────────
function Onboarding({ onComplete }) {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput]       = React.useState("");
  const [stage, setStage]       = React.useState("intro");
  const [provider, setProvider] = React.useState(null);
  const [busy, setBusy]         = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [voiceHeard, setVoiceHeard] = React.useState(false);
  const bottomRef  = React.useRef(null);
  const inputRef   = React.useRef(null);
  const recogRef   = React.useRef(null);

  // scroll to bottom on new messages
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // focus input when stage changes
  React.useEffect(() => {
    if (!["key_saving","vision_saving","done"].includes(stage)) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [stage]);

  // kick off the conversation on mount
  React.useEffect(() => {
    setTimeout(() => {
      addJarvis("Hello. I'm JARVIS — your personal AI operating system.");
    }, 300);
    setTimeout(() => {
      setStage("provider");
      addJarvis("Before we start, I need to connect to an AI brain.\n\nNo budget? Pick **Ollama** — it's free and runs on your own computer. Or choose Anthropic / OpenAI / Google if you already have a key.", "provider_chips");
    }, 1100);
  }, []);

  // cleanup voice on unmount
  React.useEffect(() => () => { try { recogRef.current?.stop(); } catch {} }, []);

  // ── Message helpers ──────────────────────────────────────────────────────────
  let msgId = Date.now();
  const addJarvis = (text, widget = null) => {
    setMessages(prev => [...prev, { id: msgId++, role: "jarvis", text, widget }]);
  };
  const addUser = (text) => {
    setMessages(prev => [...prev, { id: msgId++, role: "user", text }]);
  };

  // ── Stage handlers ───────────────────────────────────────────────────────────
  const handleProviderPick = (p) => {
    setProvider(p);
    addUser(p.name);
    if (p.keyless) { handleOllamaPick(); return; } // Ollama needs no key
    setStage("apikey");
    setTimeout(() => {
      addJarvis(
        `${p.name} — good choice.\n\nPaste your API key below. It goes straight into your OS keychain — never stored anywhere else.\n\nGet yours at ${p.url}`,
        "key_input"
      );
    }, 400);
  };

  // Ollama — free local AI, no key, no cost. Storing the host marks setup complete
  // (the app shows onboarding only when nothing is stored yet).
  const handleOllamaPick = async () => {
    setStage("key_saving");
    setBusy(true);
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/keys`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "ollama_host", key: "http://localhost:11434" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not connect");
      setBusy(false);
      setTimeout(() => addJarvis("Ollama connected — free local AI, no key, no cost. ✓\n\nJust keep the Ollama app running on your computer."), 300);
      setTimeout(() => {
        setStage("voice");
        addJarvis("Now let's make sure voice works.\n\nSay **\"Jarvis\"** out loud. I'll respond — or type skip to set it up later.", "voice_test");
      }, 1200);
    } catch (e) {
      setBusy(false);
      setStage("provider");
      setTimeout(() => addJarvis(`Couldn't reach the JARVIS engine: ${e.message}\n\nMake sure the engine window is running, then try again.`), 200);
    }
  };

  const handleKeySave = async (rawKey) => {
    const key = rawKey.trim();
    if (!key) return;
    addUser("••••••••••••••••");
    setStage("key_saving");
    setBusy(true);
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/keys`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, key }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");

      setBusy(false);
      setTimeout(() => {
        addJarvis("Key saved. ✓");
      }, 300);
      setTimeout(() => {
        setStage("voice");
        addJarvis(
          "Now let's make sure voice works.\n\nSay **\"Jarvis\"** out loud. I'll respond. Or type skip if you'd rather set up voice later.",
          "voice_test"
        );
      }, 900);
    } catch (e) {
      setBusy(false);
      setStage("apikey");
      setTimeout(() => addJarvis(`Couldn't save that key: ${e.message}\n\nDouble-check it and try again.`), 200);
    }
  };

  const startVoiceTest = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addJarvis("No microphone access in this browser. Type **skip** to continue.");
      return;
    }
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    recogRef.current = r;
    r.onresult = (e) => {
      const text = Array.from(e.results).map(x => x[0].transcript).join(" ").toLowerCase();
      if (text.includes("jarvis")) {
        try { r.stop(); } catch {}
        setVoiceHeard(true);
        setListening(false);
        const u = new SpeechSynthesisUtterance("I'm here.");
        u.rate = 0.95; u.pitch = 0.85;
        window.speechSynthesis.speak(u);
        setTimeout(() => {
          addJarvis("I heard you. Voice is working. ✓");
          proceedToVision();
        }, 800);
      }
    };
    r.onerror = () => setListening(false);
    r.onend   = () => setListening(false);
    try { r.start(); setListening(true); } catch {
      addJarvis("Couldn't start the mic. Type **skip** to continue.");
    }
  };

  const skipVoice = () => {
    addUser("skip");
    addJarvis("No problem — you can enable voice anytime from the orb.");
    setTimeout(proceedToVision, 600);
  };

  const proceedToVision = () => {
    setStage("vision");
    setTimeout(() => {
      addJarvis(
        "One more thing — what are you trying to build or achieve?\n\nThis becomes my north star. Every agent reads it before every task. Be specific: who you are, what you're building, what success looks like in the next 90 days."
      );
    }, 400);
  };

  const handleVisionSave = async (vision) => {
    if (!vision.trim() || vision.trim().toLowerCase() === "skip") {
      addUser(vision.trim().toLowerCase() === "skip" ? "skip" : vision);
      addJarvis("Understood — you can set your vision anytime from settings.");
      setTimeout(proceedToPermission, 600);
      return;
    }
    addUser(vision.length > 60 ? vision.slice(0, 60) + "…" : vision);
    setStage("vision_saving");
    setBusy(true);
    try {
      await fetch(`${window.DAEMON_URL}/api/master-vision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: vision.trim() }),
      });
    } catch {} finally { setBusy(false); }
    setTimeout(() => addJarvis("Got it. That's locked in as my north star. ✓"), 300);
    setTimeout(proceedToPermission, 900);
  };

  const proceedToPermission = () => {
    setStage("permission");
    setTimeout(() => {
      addJarvis(
        "Last thing — how much autonomy do you want me to have?\n\nPick a mode or type its name:",
        "permission_chips"
      );
    }, 400);
  };

  const handlePermission = async (mode) => {
    const m = PERMISSION_MODES.find(x => x.id === mode || x.label.toLowerCase() === mode.toLowerCase());
    if (!m) {
      addJarvis("I didn't catch that. Type safe, productive, auto, or bypass.");
      return;
    }
    addUser(m.label);
    try {
      await fetch(`${window.DAEMON_URL}/api/permission/mode`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m.id }),
      });
    } catch {}
    setStage("done");
    setTimeout(() => addJarvis(`${m.label} mode set. ✓`), 300);
    setTimeout(() => {
      addJarvis("All set. Welcome aboard.\n\nHold space to talk, or press the mic button. I'm always here.");
    }, 900);
    setTimeout(() => onComplete(), 3200);
  };

  // ── User sends a message ────────────────────────────────────────────────────
  const send = (text = input) => {
    const val = (text || "").trim();
    if (!val || busy || stage === "key_saving" || stage === "vision_saving" || stage === "done") return;
    setInput("");

    // Route based on stage
    if (stage === "provider") {
      const p = PROVIDERS.find(x => x.name.toLowerCase().includes(val.toLowerCase()) || x.id.includes(val.toLowerCase()));
      if (p) { handleProviderPick(p); return; }
      addUser(val);
      addJarvis("I didn't catch that. Pick **Ollama** for free (no key needed), or type **Anthropic**, **OpenAI**, or **Google** — or click a chip below.", "provider_chips");
      return;
    }

    if (stage === "apikey") {
      handleKeySave(val);
      return;
    }

    if (stage === "voice") {
      if (val.toLowerCase() === "skip") { skipVoice(); return; }
      addUser(val);
      addJarvis("Say the word out loud, or type **skip** to move on.");
      return;
    }

    if (stage === "vision") {
      handleVisionSave(val);
      return;
    }

    if (stage === "permission") {
      handlePermission(val);
      return;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Placeholder text by stage ───────────────────────────────────────────────
  const placeholder = {
    intro:          "...",
    provider:       "Pick Ollama (free) or type a provider…",
    apikey:         `Paste your ${provider?.name || ""} API key…`,
    key_saving:     "Saving…",
    voice:          "Type skip to continue…",
    vision:         "Describe what you're building and what success looks like…",
    vision_saving:  "Saving…",
    permission:     "Type safe, productive, auto, or bypass…",
    done:           "Opening JARVIS…",
  }[stage] || "…";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "var(--bg)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 12,
        flexShrink: 0,
        background: "var(--surface)",
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "var(--primary-soft)",
          border: "1.5px solid var(--primary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "var(--primary)",
        }}>J</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>JARVIS</div>
          <div className="mono" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em" }}>INITIAL SETUP</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "24px 20px 12px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: "flex",
            flexDirection: msg.role === "user" ? "row-reverse" : "row",
            gap: 10, alignItems: "flex-start",
          }}>
            {/* Avatar */}
            {msg.role === "jarvis" && (
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: "var(--primary-soft)", border: "1px solid var(--primary)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "var(--primary)", marginTop: 2,
              }}>J</div>
            )}

            {/* Bubble */}
            <div style={{
              maxWidth: "78%",
              background: msg.role === "user" ? "var(--primary-soft)" : "var(--surface)",
              border: `1px solid ${msg.role === "user" ? "var(--primary)" : "var(--border)"}`,
              borderRadius: msg.role === "user"
                ? "var(--radius) var(--radius-sm) var(--radius) var(--radius)"
                : "var(--radius-sm) var(--radius) var(--radius) var(--radius)",
              padding: "10px 14px",
              fontSize: 13, lineHeight: 1.6,
              color: msg.role === "user" ? "var(--primary)" : "var(--text)",
            }}>
              {/* Text — handle bold **word** */}
              <div style={{ whiteSpace: "pre-wrap" }}>
                {msg.text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
                  chunk.startsWith("**") && chunk.endsWith("**")
                    ? <strong key={i} style={{ color: "var(--text)" }}>{chunk.slice(2, -2)}</strong>
                    : chunk
                )}
              </div>

              {/* Inline widgets */}
              {msg.widget === "provider_chips" && stage === "provider" && (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => handleProviderPick(p)} style={{
                      padding: "6px 14px",
                      background: "var(--surface-2)", color: "var(--text)",
                      border: "1px solid var(--border-2)",
                      borderRadius: "var(--radius-sm)", fontSize: 12,
                      fontWeight: 600, cursor: "pointer",
                    }}>{p.name}</button>
                  ))}
                </div>
              )}

              {msg.widget === "key_input" && stage === "apikey" && (
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <input
                    type="password"
                    autoFocus
                    placeholder={provider?.hint}
                    onKeyDown={e => { if (e.key === "Enter") { handleKeySave(e.target.value); e.target.value = ""; } }}
                    style={{
                      flex: 1, background: "var(--surface-2)", color: "var(--text)",
                      border: "1px solid var(--border-2)", padding: "8px 10px",
                      borderRadius: "var(--radius-sm)", fontSize: 12, fontFamily: "monospace",
                    }}
                  />
                  <button onClick={(e) => {
                    const inp = e.target.previousSibling;
                    handleKeySave(inp.value); inp.value = "";
                  }} style={{
                    padding: "8px 14px", background: "var(--primary)", color: "var(--on-gold)",
                    border: "none", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>Save</button>
                </div>
              )}

              {msg.widget === "voice_test" && stage === "voice" && !voiceHeard && (
                <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={startVoiceTest} disabled={listening} style={{
                    padding: "8px 16px",
                    background: listening ? "var(--primary)" : "var(--surface-2)",
                    color: listening ? "var(--on-gold)" : "var(--text)",
                    border: `1px solid ${listening ? "var(--primary)" : "var(--border-2)"}`,
                    borderRadius: "var(--radius-sm)", fontSize: 12, cursor: "pointer",
                    animation: listening ? "blink 1.2s infinite" : "none",
                  }}>
                    {listening ? "🎙 Listening…" : "🎙 Start"}
                  </button>
                  <button onClick={skipVoice} style={{
                    padding: "8px 12px", background: "none",
                    color: "var(--subtext)", border: "none", fontSize: 12, cursor: "pointer",
                  }}>skip</button>
                </div>
              )}

              {msg.widget === "permission_chips" && stage === "permission" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                  {PERMISSION_MODES.map(m => (
                    <button key={m.id} onClick={() => handlePermission(m.id)} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px", textAlign: "left",
                      background: "var(--surface-2)", border: "1px solid var(--border-2)",
                      borderRadius: "var(--radius-sm)", cursor: "pointer",
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", minWidth: 76 }}>{m.label}</span>
                      <span style={{ fontSize: 11, color: "var(--subtext)" }}>{m.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator when busy */}
        {busy && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: "var(--primary-soft)", border: "1px solid var(--primary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "var(--primary)",
            }}>J</div>
            <div className="card" style={{ padding: "10px 16px" }}>
              <span style={{ color: "var(--primary)", letterSpacing: 3, animation: "typing 1.2s infinite" }}>●●●</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--border)",
        display: "flex", gap: 8, flexShrink: 0,
        background: "var(--surface)",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={busy || ["key_saving","vision_saving","done","intro"].includes(stage)}
          style={{
            flex: 1,
            background: "var(--surface-2)", color: "var(--text)",
            border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)",
            padding: "10px 12px", fontSize: 13, resize: "none",
            fontFamily: "inherit", lineHeight: 1.4,
            opacity: (busy || stage === "apikey") ? 0.4 : 1,
          }}
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || busy}
          style={{
            padding: "0 18px",
            background: "var(--primary)", color: "var(--on-gold)",
            border: "none", borderRadius: "var(--radius-sm)",
            fontSize: 16, cursor: "pointer",
            opacity: (!input.trim() || busy) ? 0.4 : 1,
          }}>↑</button>
      </div>
    </div>
  );
}

Object.assign(window, { Onboarding });
