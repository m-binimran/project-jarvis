# Examples

These are **reference clients built on top of the base** (`../jarvis-daemon`). They are *not* part of the core — they're here to show what you can build on the daemon, and to give you something runnable out of the box. Fork them, replace them, or ignore them entirely.

| Example | What it is |
|---------|------------|
| [`orb-ui/`](orb-ui) | The "orb" web UI — a heads-up command center (voice, chat, status panels) served on `:3020`, talking to the daemon over localhost. |
| [`overlay/`](overlay) | An Electron desktop client — the always-on "pill," plus the screen-guidance overlay that draws on your screen. |

Both talk to the base only through its HTTP API (`http://127.0.0.1:9101`). That's the whole point: **the base is the engine; clients are swappable.** Build your own.
