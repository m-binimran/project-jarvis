/**
 * JARVIS Authority Engine
 *
 * Four permission modes. Circuit breakers that CANNOT be overridden.
 * A prompt cannot override a circuit breaker. Ever.
 *
 * Evaluation order per action:
 * 1. Circuit breaker? → always require approval regardless of mode
 * 2. Deny rule? → block
 * 3. Allow rule? → pass
 * 4. Mode default
 */

export type PermissionMode = "safe" | "productive" | "auto" | "bypass";

export type ActionCategory =
  | "read_file"
  | "write_file"
  | "delete_file"
  | "send_email"
  | "send_message"
  | "post_social"
  | "make_purchase"
  | "access_credentials"
  | "share_data_external"
  | "install_software"
  | "system_access"
  | "run_code"
  | "web_browse"
  | "calendar_write"
  | "agent_spawn"
  | "external_tool" // tools imported from an external MCP server (unknown blast radius)
  | "computer_use"; // moving the mouse / typing on the real OS (clicks anything) — highest risk

// These ALWAYS require explicit user confirmation regardless of mode.
// A prompt cannot bypass these. Only Settings can.
export const CIRCUIT_BREAKERS = new Set<ActionCategory>([
  "delete_file",
  "send_email",
  "send_message",
  "post_social",
  "make_purchase",
  "access_credentials",
  "share_data_external",
  "install_software",
  "system_access",
  "computer_use", // every real click/keystroke needs a human OK — no silent autopilot
]);

export type AuthDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  isCircuitBreaker: boolean;
  reason: string;
};

// Actions auto-approved in Productive mode
const PRODUCTIVE_AUTO_APPROVE = new Set<ActionCategory>([
  "read_file",
  "web_browse",
  "calendar_write",
  "run_code",
  "agent_spawn",
]);

export class AuthorityEngine {
  private mode: PermissionMode;
  private overrides = new Map<ActionCategory, "allow" | "deny">();

  constructor(mode: PermissionMode = "safe") {
    this.mode = mode;
  }

  getMode(): PermissionMode { return this.mode; }
  setMode(mode: PermissionMode): void { this.mode = mode; }

  setOverride(action: ActionCategory, decision: "allow" | "deny"): void {
    // Cannot override circuit breakers
    if (CIRCUIT_BREAKERS.has(action)) return;
    this.overrides.set(action, decision);
  }

  check(action: ActionCategory, context?: { agentLevel?: number }): AuthDecision {
    // 1. Circuit breaker — always approval required, no exceptions
    if (CIRCUIT_BREAKERS.has(action)) {
      return {
        allowed: true,
        requiresApproval: true,
        isCircuitBreaker: true,
        reason: `Circuit breaker: ${action} always requires explicit approval`,
      };
    }

    // 2. Explicit deny override
    if (this.overrides.get(action) === "deny") {
      return { allowed: false, requiresApproval: false, isCircuitBreaker: false, reason: "Denied by override" };
    }

    // 3. Explicit allow override
    if (this.overrides.get(action) === "allow") {
      return { allowed: true, requiresApproval: false, isCircuitBreaker: false, reason: "Allowed by override" };
    }

    // 4. Mode defaults
    switch (this.mode) {
      case "safe":
        return {
          allowed: true, requiresApproval: true, isCircuitBreaker: false,
          reason: "Safe mode: all actions require approval",
        };

      case "productive":
        if (PRODUCTIVE_AUTO_APPROVE.has(action)) {
          return { allowed: true, requiresApproval: false, isCircuitBreaker: false, reason: "Productive mode: auto-approved" };
        }
        return { allowed: true, requiresApproval: true, isCircuitBreaker: false, reason: "Productive mode: approval needed" };

      case "auto": {
        // Low-risk actions auto-approved; higher-risk flagged
        const lowRisk: ActionCategory[] = ["read_file", "web_browse", "run_code", "agent_spawn"];
        const auto = lowRisk.includes(action);
        return {
          allowed: true,
          requiresApproval: !auto,
          isCircuitBreaker: false,
          reason: auto ? "Auto mode: classified low-risk" : "Auto mode: flagged for approval",
        };
      }

      case "bypass":
        return {
          allowed: true, requiresApproval: false, isCircuitBreaker: false,
          reason: "Bypass mode: running without approval",
        };
    }
  }

  /**
   * Pre-clear a list of actions for an overnight/unattended task.
   * Returns which need user approval upfront.
   */
  preClear(actions: ActionCategory[]): { needsApproval: ActionCategory[]; autoApproved: ActionCategory[] } {
    const needsApproval: ActionCategory[] = [];
    const autoApproved: ActionCategory[] = [];

    for (const action of actions) {
      const d = this.check(action);
      if (d.requiresApproval) needsApproval.push(action);
      else autoApproved.push(action);
    }

    return { needsApproval, autoApproved };
  }
}
