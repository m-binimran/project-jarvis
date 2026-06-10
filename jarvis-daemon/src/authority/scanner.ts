/**
 * JARVIS Prompt Injection Scanner
 * TypeScript equivalent of LlamaFirewall / PromptGuard 2.
 *
 * Runs on every incoming user message before it reaches any agent.
 * Three checks:
 *   1. Jailbreak detection — known patterns trying to override behaviour
 *   2. Injection detection — instructions embedded in data (e.g. malicious email content)
 *   3. Circuit breaker override attempts — trying to bypass safety rules via prompt
 *
 * Returns a ScanResult with a risk level and reason.
 * BLOCKED messages never reach the agent.
 */

export type RiskLevel = "safe" | "suspicious" | "blocked";

export interface ScanResult {
  risk: RiskLevel;
  reason: string;
  flaggedPatterns: string[];
}

// ── Pattern sets ─────────────────────────────────────────────────────────────

// Attempts to override the system prompt or agent identity
const JAILBREAK_PATTERNS = [
  /ignore\s+(all\s+)?(?:previous|prior|above|your)\s+instructions?/i,
  /disregard\s+(?:all\s+)?(?:previous|your|the)\s+/i,
  /forget\s+(?:everything|all)\s+(?:you|i|we)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /act\s+as\s+(?:if\s+you\s+(?:were|are)\s+)?(?:a|an|the)\s+/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+/i,
  /roleplay\s+as\s+/i,
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /###\s*instruction/i,
];

// Attempts to make JARVIS skip circuit breakers or permission checks
const CIRCUIT_BYPASS_PATTERNS = [
  /do\s+not\s+ask\s+(?:me\s+for\s+)?(?:permission|confirmation|approval)/i,
  /skip\s+(?:the\s+)?(?:approval|confirmation|permission|verification)/i,
  /without\s+(?:asking|confirming|approval|permission)/i,
  /bypass\s+(?:the\s+)?(?:safety|permission|circuit|check)/i,
  /override\s+(?:the\s+)?(?:safety|circuit\s+breaker|permission)/i,
  /no\s+need\s+to\s+(?:ask|confirm|verify)/i,
  /trust\s+me[,\s]+just\s+do/i,
];

// Prompt injection via data — instructions embedded in content JARVIS is processing
const INJECTION_PATTERNS = [
  /\[(?:new|hidden|secret)\s+instruction/i,
  /<!--\s*SYSTEM:/i,
  /\{\{(?:system|prompt|instruction)\}\}/i,
  /ignore\s+the\s+(?:above|previous)/i,
  /translate\s+the\s+above.*?instead/is,
  /your\s+new\s+(?:task|job|role|instruction)\s+is/i,
  /from\s+now\s+on\s+you\s+(?:must|will|should)/i,
];

// ── Scanner ───────────────────────────────────────────────────────────────────

export function scanMessage(message: string): ScanResult {
  const flagged: string[] = [];

  // Check jailbreak patterns
  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(message)) {
      flagged.push(`jailbreak: ${pattern.source.slice(0, 40)}`);
    }
  }

  // Check circuit breaker bypass attempts
  for (const pattern of CIRCUIT_BYPASS_PATTERNS) {
    if (pattern.test(message)) {
      flagged.push(`circuit_bypass: ${pattern.source.slice(0, 40)}`);
    }
  }

  // Check for injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      flagged.push(`injection: ${pattern.source.slice(0, 40)}`);
    }
  }

  if (flagged.length === 0) {
    return { risk: "safe", reason: "No threats detected", flaggedPatterns: [] };
  }

  // Circuit bypass = immediate block — non-negotiable
  const hasCircuitBypass = flagged.some(f => f.startsWith("circuit_bypass"));
  if (hasCircuitBypass) {
    return {
      risk: "blocked",
      reason: "Attempt to bypass circuit breakers detected. This message will not be processed.",
      flaggedPatterns: flagged,
    };
  }

  // Multiple flags or clear jailbreak = blocked
  if (flagged.length >= 2 || flagged.some(f => f.startsWith("jailbreak"))) {
    return {
      risk: "blocked",
      reason: "Jailbreak attempt detected. Message blocked.",
      flaggedPatterns: flagged,
    };
  }

  // Single injection pattern = suspicious (warn but allow)
  return {
    risk: "suspicious",
    reason: "Message contains potentially injected instructions. Proceeding with caution.",
    flaggedPatterns: flagged,
  };
}
