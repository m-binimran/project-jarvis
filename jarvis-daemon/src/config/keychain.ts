/**
 * JARVIS Keychain — OS-native secret storage
 *
 * Uses Windows Credential Manager / macOS Keychain via `keytar`.
 * API keys NEVER touch SQLite. They live only in the OS keychain.
 *
 * Service namespace: "jarvis-daemon"
 * Account format:    "provider:<name>"  e.g. "provider:anthropic"
 */

import keytar from "keytar";

const SERVICE = "jarvis-daemon";

export type ProviderKey =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "nvidia"
  | "google"
  | "ollama_host"
  | "slack_bot_token"
  | "slack_app_token"
  | "sidecar_secret"
  | "smtp_password";

export const KeychainAccounts = {
  provider: (name: ProviderKey) => `provider:${name}`,
  custom: (tag: string) => `custom:${tag}`,
} as const;

export async function storeKey(account: string, secret: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, secret);
}

export async function getKey(account: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, account);
}

export async function deleteKey(account: string): Promise<void> {
  await keytar.deletePassword(SERVICE, account);
}

export async function listKeys(): Promise<{ account: string }[]> {
  const creds = await keytar.findCredentials(SERVICE);
  return creds.map(c => ({ account: c.account }));
}

/** Convenience — get an LLM provider API key by provider name */
export async function getProviderKey(provider: ProviderKey): Promise<string | null> {
  return getKey(KeychainAccounts.provider(provider));
}

export async function setProviderKey(provider: ProviderKey, key: string): Promise<void> {
  return storeKey(KeychainAccounts.provider(provider), key);
}

// ─── Generic namespaced accessor (used by connector modules) ─────────────────

export interface KeychainAccessor {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string): Promise<void>;
  del(namespace: string, key: string): Promise<void>;
}

class KeychainAccessorImpl implements KeychainAccessor {
  async get(namespace: string, key: string): Promise<string | null> {
    return keytar.getPassword(namespace, key);
  }
  async set(namespace: string, key: string, value: string): Promise<void> {
    await keytar.setPassword(namespace, key, value);
  }
  async del(namespace: string, key: string): Promise<void> {
    await keytar.deletePassword(namespace, key);
  }
}

let _accessor: KeychainAccessor | null = null;

/** Returns a generic accessor that supports any namespace (for connector modules) */
export function getKeychain(): KeychainAccessor {
  if (!_accessor) _accessor = new KeychainAccessorImpl();
  return _accessor;
}
