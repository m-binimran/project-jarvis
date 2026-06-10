/**
 * Sensitive Data Auto-Redaction — Decision 10b
 *
 * Before anything gets written to the Vault, disk, or any log,
 * this scanner strips: API keys, passwords, card numbers, credentials.
 * These are NEVER stored raw. Ever.
 */

const PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // API keys
  { name: "anthropic_key",  pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g,     replacement: "[REDACTED:anthropic-key]" },
  { name: "openai_key",     pattern: /sk-[a-zA-Z0-9]{32,}/g,            replacement: "[REDACTED:openai-key]" },
  { name: "google_key",     pattern: /AIza[a-zA-Z0-9_-]{35}/g,          replacement: "[REDACTED:google-key]" },
  { name: "elevenlabs_key", pattern: /[a-f0-9]{32}(?:[a-f0-9]{8})?/g,  replacement: "[REDACTED:api-key]" },
  { name: "generic_bearer", pattern: /Bearer [a-zA-Z0-9_\-.]{20,}/g,    replacement: "Bearer [REDACTED]" },
  // Passwords in common patterns
  { name: "password_field", pattern: /"password"\s*:\s*"[^"]+"/gi,      replacement: '"password":"[REDACTED]"' },
  { name: "passwd_field",   pattern: /"passwd"\s*:\s*"[^"]+"/gi,        replacement: '"passwd":"[REDACTED]"' },
  // Credit card numbers (basic Luhn pattern)
  { name: "card_number",    pattern: /\b(?:\d[ -]?){13,16}\b/g,         replacement: "[REDACTED:card]" },
  // AWS keys
  { name: "aws_access",     pattern: /AKIA[A-Z0-9]{16}/g,               replacement: "[REDACTED:aws-key]" },
  { name: "aws_secret",     pattern: /[a-zA-Z0-9+/]{40}(?=\s|$)/g,     replacement: "[REDACTED:aws-secret]" },
];

export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactObject(obj: unknown): unknown {
  if (typeof obj === "string") return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, redactObject(v)])
    );
  }
  return obj;
}
