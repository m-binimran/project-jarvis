/**
 * JARVIS Firewall — TS-native LlamaFirewall / NeMo Guardrails equivalent.
 *
 * Four inline checks. Zero Python. Zero extra latency. Baked into the walls,
 * not standing at a separate door (Decision 10b).
 *
 *   1. PromptGuard   — scans USER INPUT for jailbreaks / injection (pre-agent)
 *   2. AlignmentCheck — scans AGENT OUTPUT for goal drift & data exfiltration
 *   3. CodeShield    — scans CODE / SHELL commands before execution
 *   4. OutputFilter  — scans OUTGOING responses for leaked secrets (redacts)
 *
 * Inspired by Meta LlamaFirewall (PromptGuard 2 + AlignmentCheck + CodeShield)
 * and NVIDIA NeMo Guardrails — reimplemented natively per Decision 2 (MIT-clean).
 *
 * Every function here is PURE and deterministic — fully testable with no API key.
 */

import { scanMessage } from "./scanner.ts";
import { redact } from "../vault/redact.ts";

export type FirewallVerdict = "allow" | "flag" | "block";
export type FirewallLayer = "promptguard" | "alignment" | "codeshield" | "output";

export interface FirewallResult {
  verdict: FirewallVerdict;
  /** 0–100 risk score */
  score: number;
  layer: FirewallLayer;
  reasons: string[];
  flagged: string[];
  /** OutputFilter only: the redacted text safe to deliver */
  sanitized?: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
  /** risk weight 0–100 */
  weight: number;
}

// Risk thresholds
const BLOCK_AT = 70;
const FLAG_AT = 35;

function verdictFor(score: number): FirewallVerdict {
  if (score >= BLOCK_AT) return "block";
  if (score >= FLAG_AT) return "flag";
  return "allow";
}

function applyRules(text: string, rules: Rule[], layer: FirewallLayer, okReason: string): FirewallResult {
  let score = 0;
  const reasons: string[] = [];
  const flagged: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      score = Math.max(score, rule.weight);
      reasons.push(`${rule.name} (risk ${rule.weight})`);
      flagged.push(rule.name);
    }
  }
  if (flagged.length === 0) reasons.push(okReason);
  return { verdict: verdictFor(score), score, layer, reasons, flagged };
}

// ── Layer 1: PromptGuard (input) ──────────────────────────────────────────────
// Reuses the existing pattern scanner, normalised into a FirewallResult.

export function promptGuard(input: string): FirewallResult {
  const scan = scanMessage(input);
  const score = scan.risk === "blocked" ? 90 : scan.risk === "suspicious" ? 50 : 0;
  const verdict: FirewallVerdict =
    scan.risk === "blocked" ? "block" : scan.risk === "suspicious" ? "flag" : "allow";
  return {
    verdict,
    score,
    layer: "promptguard",
    reasons: [scan.reason],
    flagged: scan.flaggedPatterns,
  };
}

// ── Layer 2: AlignmentCheck (agent output) ────────────────────────────────────
// Detects an agent that has been hijacked: acting on injected instructions,
// exfiltrating data, or disabling its own safety.

const ALIGNMENT_RULES: Rule[] = [
  {
    name: "acting-on-injected-instruction",
    pattern: /\bas\s+(?:instructed|requested|directed|told)\s+(?:in|by)\s+the\s+(?:email|message|document|file|page|website|content|attachment|comment)/i,
    weight: 80,
  },
  {
    name: "following-external-instruction",
    pattern: /\bthe\s+(?:email|document|message|website|page|file)\s+(?:says|instructs|tells|asks|wants)\s+(?:me\s+)?to\b/i,
    weight: 70,
  },
  {
    name: "self-disable-safety",
    pattern: /\bI\s+(?:have\s+|will\s+|am\s+going\s+to\s+|'ll\s+)?(?:disabled?|bypass(?:ed|ing)?|ignor(?:ed|ing)|turn(?:ed|ing)?\s+off|override?|overrode|overriding)\s+(?:the\s+|my\s+)?(?:safety|firewall|permission|circuit\s*breaker|guard\s*rail|security)/i,
    weight: 95,
  },
  {
    name: "credential-exfiltration",
    pattern: /\b(?:send|forward|upload|email|post|transmit|share|leak|paste|expos|exfiltrat)\w*\b.{0,40}\b(?:password|api[\s_-]*key|credential|secret|private[\s_-]*key|access[\s_-]*token|token)s?\b/i,
    weight: 90,
  },
  {
    name: "mass-data-exfiltration",
    pattern: /\b(?:send|forward|upload|email|copy|export)\w*\b.{0,30}\b(?:all|every|entire)\b.{0,30}\b(?:file|email|contact|document|record|data)s?\b.{0,40}\b(?:to|external|http)/i,
    weight: 75,
  },
  {
    name: "external-send-to-url",
    pattern: /\b(?:send|post|upload|exfiltrat|transmit)\w*\b.{0,40}\bhttps?:\/\//i,
    weight: 70,
  },
];

export function checkAlignment(output: string, _brief?: string): FirewallResult {
  return applyRules(output, ALIGNMENT_RULES, "alignment", "Output aligned with intended behaviour");
}

// ── Layer 3: CodeShield (code / shell) ────────────────────────────────────────
// Scans any command or code before it executes. Covers bash, PowerShell, cmd,
// plus JS/Python danger idioms.

const SHELL_RULES: Rule[] = [
  { name: "delete-root", pattern: /\brm\s+-[rf]{1,2}\b\s+(?:\/|~|\/\*|\.\*|\$HOME)\b/i, weight: 100 },
  { name: "recursive-delete", pattern: /\brm\s+-[rf]{1,2}\b/i, weight: 80 },
  { name: "windows-recursive-delete", pattern: /\b(?:rd|rmdir)\s+\/s\b|del\s+\/[fsq]/i, weight: 75 },
  { name: "powershell-recursive-delete", pattern: /remove-item\b[^\n]*-recurse[^\n]*-force/i, weight: 75 },
  { name: "format-drive", pattern: /\bformat\s+[a-z]:|mkfs\.\w+|\bformat\s+\//i, weight: 100 },
  { name: "disk-overwrite", pattern: /\bdd\s+if=.*of=\/dev\/|>\s*\/dev\/sd[a-z]/i, weight: 100 },
  { name: "fork-bomb", pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, weight: 100 },
  { name: "pipe-to-shell", pattern: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(?:bash|sh|zsh|powershell|pwsh|iex)\b/i, weight: 95 },
  { name: "iex-download", pattern: /\biex\s*\(.*(?:downloadstring|invoke-webrequest|net\.webclient|downloadfile)/i, weight: 95 },
  { name: "invoke-expression-remote", pattern: /invoke-expression\b.*(?:http|downloadstring|webclient)/i, weight: 90 },
  { name: "reverse-shell", pattern: /\b(?:nc|ncat|netcat)\b[^\n]*-e\s|\bbash\s+-i\s*>&\s*\/dev\/tcp|\/dev\/tcp\/\d/i, weight: 100 },
  { name: "overwrite-system-auth", pattern: />\s*\/etc\/(?:passwd|shadow|sudoers)/i, weight: 100 },
  { name: "privilege-chmod", pattern: /chmod\s+-?R?\s*777\s+\//i, weight: 75 },
  { name: "add-admin-user", pattern: /net\s+user\b[^\n]*\/add|net\s+localgroup\s+administrators\b[^\n]*\/add/i, weight: 85 },
  { name: "registry-delete", pattern: /\breg\s+delete\s+hk(?:lm|cu)|remove-itemproperty\s+hk/i, weight: 70 },
  { name: "disable-firewall", pattern: /netsh\s+advfirewall[^\n]*\boff\b|set-mppreference[^\n]*-disable/i, weight: 85 },
  { name: "exfil-upload", pattern: /\b(?:curl|wget)\b[^\n]*(?:-d\s*@|--data(?:-binary)?\s*@|-F\s+\w+=@|-T\s+\S)/i, weight: 80 },
  { name: "base64-pipe-shell", pattern: /base64\s+-d\b[^|]*\|\s*(?:bash|sh)\b/i, weight: 90 },
  { name: "power-shutdown", pattern: /\bshutdown\b|\breboot\b[^\n]*-f|\bhalt\s+-/i, weight: 50 },
];

const CODE_RULES: Rule[] = [
  { name: "js-child-process-destroy", pattern: /child_process[\s\S]{0,60}(?:rm\s+-rf|rmdir|unlinkSync)/i, weight: 70 },
  { name: "py-rmtree-root", pattern: /shutil\.rmtree\(\s*['"]?(?:\/|~|C:\\)/i, weight: 80 },
  { name: "py-os-system-rm", pattern: /os\.system\([^)]*rm\s+-rf/i, weight: 80 },
  { name: "eval-network", pattern: /\beval\(\s*(?:await\s+)?(?:fetch|require\(['"]https?|requests\.get|urllib)/i, weight: 75 },
  { name: "py-exec-remote", pattern: /exec\([^)]*(?:urlopen|requests\.get|urllib\.request)/i, weight: 85 },
];

export function checkCode(code: string, kind: "shell" | "js" | "python" = "shell"): FirewallResult {
  const rules = kind === "shell" ? SHELL_RULES : [...SHELL_RULES, ...CODE_RULES];
  return applyRules(code, rules, "codeshield", "No dangerous operations detected");
}

// ── Layer 4: OutputFilter (response → user) ───────────────────────────────────
// Detects secrets leaking into a response and redacts them. Never blocks the
// reply — it sanitises so the user still gets their answer, minus the secret.

const SECRET_DETECTORS: Rule[] = [
  { name: "anthropic-key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, weight: 50 },
  { name: "openai-key", pattern: /sk-[a-zA-Z0-9]{32,}/, weight: 50 },
  { name: "google-key", pattern: /AIza[a-zA-Z0-9_-]{35}/, weight: 50 },
  { name: "aws-key", pattern: /AKIA[A-Z0-9]{16}/, weight: 50 },
  { name: "github-token", pattern: /ghp_[a-zA-Z0-9]{36}/, weight: 50 },
  { name: "slack-token", pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/, weight: 50 },
  { name: "private-key-block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, weight: 60 },
  { name: "bearer-token", pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/, weight: 40 },
];

export function filterOutput(text: string): FirewallResult {
  let score = 0;
  const flagged: string[] = [];
  for (const det of SECRET_DETECTORS) {
    if (det.pattern.test(text)) {
      score = Math.max(score, det.weight);
      flagged.push(det.name);
    }
  }
  const leaked = flagged.length > 0;
  return {
    verdict: leaked ? "flag" : "allow", // sanitise, don't block — user still gets the reply
    score,
    layer: "output",
    reasons: leaked
      ? [`Secrets detected and redacted before delivery: ${flagged.join(", ")}`]
      : ["No secrets in output"],
    flagged,
    sanitized: leaked ? redact(text) : text,
  };
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

export const firewall = { promptGuard, checkAlignment, checkCode, filterOutput };
