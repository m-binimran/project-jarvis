# Privacy & telemetry — the guarantee

JARVIS is **local-first, bring-your-own-key, and zero-telemetry**. This is a core
property of the kernel, not a setting. This document states the guarantee and
shows you how to verify it yourself — don't take our word for it.

## The three guarantees

1. **Local-first.** All state lives in a single SQLite file on your machine
   (`~/.jarvis/vault.db`): conversations, the audit chain, memory, keys metadata.
   Nothing is uploaded by default. Memory embeddings are computed by a **local**
   Ollama model; if Ollama isn't running, memory degrades to on-device keyword
   recall — it never ships your notes anywhere to "work."

2. **Bring your own key.** The kernel ships with **no** API keys and **no**
   vendor backend. You choose the model. Keys are stored in your OS keychain.
   Use `OllamaProvider` and the kernel is 100% offline (no outbound calls at all).

3. **Zero telemetry.** There is no analytics, tracking, crash reporting, or
   "phone-home" of any kind. No Segment, PostHog, Mixpanel, Amplitude, Sentry,
   Datadog, Google Analytics — none. The kernel never contacts an
   Anthropic/JARVIS/author-owned server.

## The complete outbound surface

The kernel (the lean trunk) only ever makes a network request to:

| Destination | When | Why | Carries your data? |
|-------------|------|-----|--------------------|
| `localhost:11434` (Ollama) | model / embeddings, if you use Ollama | local inference | stays on device |
| Your chosen LLM provider (NVIDIA NIM, OpenAI-compatible, Anthropic, Google, DeepSeek) | a model call, with **your** key | inference | yes — to the provider you picked, same as any LLM app |

That's it. There is no destination you didn't choose. (The full JARVIS *app* adds
optional, explicitly user-connected integrations — Google Workspace via OAuth you
grant, and an opt-in advisor-content scraper that reads public essay sites. Those
are app branches, not the kernel, and they pull data **in**; none send your data
to an author-owned endpoint.)

## Verify it yourself

No telemetry SDKs anywhere in the source:

```bash
grep -rniE 'segment|posthog|mixpanel|amplitude|sentry|datadog|google-analytics|gtag|sendBeacon|telemetry' src
# (only match is the word "analytics" inside an advisor's text content)
```

Every outbound host in the source:

```bash
grep -rhoE 'https?://[a-zA-Z0-9._/-]+' src | sort -u
# → localhost (Ollama) + the LLM provider base URLs only
```

Run fully offline to prove it: use `OllamaProvider`, then watch the process make
zero outbound connections.

## The audit trail is yours

Every tool call, permission check, and result is written to a tamper-evident hash
chain in **your** local vault. You can read it, export it, or wipe it. It is for
your inspection, not ours — it is never transmitted.
