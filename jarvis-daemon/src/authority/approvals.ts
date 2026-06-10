/**
 * JARVIS Approval Manager
 *
 * Bridges the gap between:
 *   - The agent runner's async onApprovalNeeded callback (waits for a bool)
 *   - The overlay client that renders Approve/Deny buttons and POSTs a response
 *
 * Flow:
 *   1. Agent triggers circuit breaker — runner calls onApprovalNeeded
 *   2. onApprovalNeeded creates a pending approval, writes approval_needed SSE event
 *   3. Runner awaits the approval promise (times out after 60s = deny)
 *   4. Overlay user clicks Approve or Deny
 *   5. Client POSTs to /api/approval/:requestId
 *   6. ApprovalManager resolves the promise → runner continues
 */

import { generateId } from "../vault/schema.ts";

export interface PendingApproval {
  requestId: string;
  agentId: string;
  action: string;
  context: string;
  createdAt: number;
}

const TIMEOUT_MS = 60_000; // 60 seconds — then auto-deny

class ApprovalManager {
  private pending = new Map<
    string,
    {
      approval: PendingApproval;
      resolve: (approved: boolean) => void;
    }
  >();

  /**
   * Create a pending approval and return a promise that resolves when
   * the user approves or denies (or times out).
   */
  request(agentId: string, action: string, context: string): {
    requestId: string;
    promise: Promise<boolean>;
  } {
    const requestId = generateId();

    const promise = new Promise<boolean>((resolve) => {
      const approval: PendingApproval = {
        requestId,
        agentId,
        action,
        context,
        createdAt: Date.now(),
      };

      this.pending.set(requestId, { approval, resolve });

      // Auto-deny after timeout
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          console.warn(`[Approvals] Request ${requestId} timed out — auto-denied`);
          this.respond(requestId, false);
        }
      }, TIMEOUT_MS);
    });

    return { requestId, promise };
  }

  /**
   * Resolve a pending approval with the user's decision.
   * Returns true if the request was found and resolved.
   */
  respond(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;

    this.pending.delete(requestId);
    entry.resolve(approved);
    return true;
  }

  /** List all pending approvals (for UI polling fallback) */
  listPending(): PendingApproval[] {
    return [...this.pending.values()].map(e => e.approval);
  }

  /** Check if a request exists */
  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }
}

// Singleton
let _manager: ApprovalManager | null = null;

export function getApprovalManager(): ApprovalManager {
  if (!_manager) _manager = new ApprovalManager();
  return _manager;
}
