/**
 * JARVIS Config Loader
 *
 * Reads settings from the DB (settings table), merges with runtime defaults,
 * and exposes a typed config object. API keys come from the keychain — never here.
 */

import { getDb } from "../vault/schema.ts";
import { getProviderKey } from "./keychain.ts";
import { LLMManager } from "../llm/manager.ts";
import { AnthropicProvider } from "../llm/anthropic.ts";
import { OllamaProvider } from "../llm/ollama.ts";
import { GoogleProvider } from "../llm/google.ts";
import { makeOpenAI, makeDeepseek, makeNvidia } from "../llm/openai.ts";

export interface JarvisConfig {
  mode: "basic" | "enterprise";
  primaryProvider: string;
  ollamaHost: string;
  daemonPort: number;
  sidecarEnabled: boolean;
  tokenBarEnabled: boolean;
  threeStrikesLimit: number;
}

const DEFAULTS: JarvisConfig = {
  mode: "basic",
  primaryProvider: "anthropic",
  ollamaHost: "http://localhost:11434",
  daemonPort: 9101,
  sidecarEnabled: false,
  tokenBarEnabled: true,
  threeStrikesLimit: 3,
};

function getSetting(key: string, fallback: string): string {
  try {
    const db = getDb();
    const row = db.query<{ value: string }, [string]>(
      `SELECT value FROM settings WHERE key = ?`
    ).get(key);
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadConfig(): JarvisConfig {
  return {
    mode: (getSetting("mode", DEFAULTS.mode) as JarvisConfig["mode"]),
    primaryProvider: getSetting("primary_provider", DEFAULTS.primaryProvider),
    ollamaHost: getSetting("ollama_host", DEFAULTS.ollamaHost),
    daemonPort: parseInt(getSetting("daemon_port", String(DEFAULTS.daemonPort)), 10),
    sidecarEnabled: getSetting("sidecar_enabled", "false") === "true",
    tokenBarEnabled: getSetting("token_bar_enabled", "true") === "true",
    threeStrikesLimit: parseInt(getSetting("three_strikes_limit", String(DEFAULTS.threeStrikesLimit)), 10),
  };
}

export function saveSetting(key: string, value: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value, Date.now()]
  );
}

/**
 * Bootstrap the LLM manager from config + keychain.
 * Called once at daemon startup.
 */
export async function buildLLMManager(): Promise<LLMManager> {
  const manager = new LLMManager();
  await configureProviders(manager);
  return manager;
}

/**
 * (Re)register every provider from the keychain and set the primary/fallback order.
 * Safe to call again any time a key changes — register() overwrites by name, so a
 * freshly-saved key takes effect immediately with no daemon restart.
 */
export async function configureProviders(manager: LLMManager): Promise<void> {
  const cfg = loadConfig();

  // Ollama — always available (local, free)
  manager.register(new OllamaProvider(cfg.ollamaHost));

  // Cloud brains — registered only if a key is present
  const anthropicKey = await getProviderKey("anthropic");
  if (anthropicKey) manager.register(new AnthropicProvider(anthropicKey));
  const googleKey = await getProviderKey("google");
  if (googleKey) manager.register(new GoogleProvider(googleKey));
  const openaiKey = await getProviderKey("openai");
  if (openaiKey) manager.register(makeOpenAI(openaiKey));
  const deepseekKey = await getProviderKey("deepseek");
  if (deepseekKey) manager.register(makeDeepseek(deepseekKey));
  const nvidiaKey = await getProviderKey("nvidia");
  if (nvidiaKey) manager.register(makeNvidia(nvidiaKey));

  // Prefer a CLOUD brain when a key exists: no RAM use, faster, won't crash on
  // low-memory machines. Local Ollama is always the offline backup (last).
  const names = manager.getProviderNames();
  const pref = ["anthropic", "openai", "nvidia", "google", "deepseek", "ollama"];
  const primary = pref.find(p => names.includes(p)) ?? names[0];
  if (primary) manager.setPrimary(primary);
  const fallbackOrder = pref.filter(p => p !== primary && names.includes(p));
  manager.setFallback(fallbackOrder);
}
