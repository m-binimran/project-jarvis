/**
 * A2A — Agent-to-Agent Message Bus
 *
 * Decision 10ac: MCP handles agent→tools (vertical).
 *                A2A handles agent→agent (horizontal).
 *
 * Agents communicate directly without routing through the user.
 * This is the "hive mind" pattern — validated by @lukebuildsai's Slack setup
 * (their Slack channels ARE an A2A bus; we formalise it here as a typed system).
 *
 * Message types:
 *   request     — agent asks another agent to do work
 *   response    — reply to a request
 *   handoff     — hand the entire task to another agent
 *   escalate    — ask team lead / orchestrator for help
 *   share       — broadcast context or findings to interested agents
 *   ack         — simple acknowledgement
 */

import { EventEmitter } from "node:events";
import { generateId, now } from "../vault/schema.ts";
import { getAuditTrail } from "../authority/audit.ts";

// ─── Message types ───────────────────────────────────────────────────────────

export type A2AMessageType =
  | "request"
  | "response"
  | "handoff"
  | "escalate"
  | "share"
  | "ack";

export interface A2AMessage {
  id: string;
  type: A2AMessageType;
  from: string;           // agent id
  to: string | null;      // agent id, or null for broadcast
  department?: string;    // scope broadcast to one department
  subject: string;        // short description of what this is about
  content: string;        // the actual message / context to share
  taskId?: string;        // originating task, if any
  replyTo?: string;       // id of message being replied to
  ts: number;             // unix ms
}

export type A2AHandler = (msg: A2AMessage) => void | Promise<void>;

// ─── Bus ─────────────────────────────────────────────────────────────────────

export class A2AMessageBus extends EventEmitter {
  private subscriptions = new Map<string, A2AHandler>();     // agentId → handler
  private departmentMap = new Map<string, Set<string>>();    // deptId → Set<agentId>
  private history: A2AMessage[] = [];
  private maxHistory = 200;

  /**
   * Register an agent to receive messages.
   */
  subscribe(agentId: string, handler: A2AHandler): void {
    this.subscriptions.set(agentId, handler);
  }

  unsubscribe(agentId: string): void {
    this.subscriptions.delete(agentId);
  }

  /**
   * Register an agent as belonging to a department.
   * Enables department-scoped broadcasts.
   */
  joinDepartment(agentId: string, departmentId: string): void {
    if (!this.departmentMap.has(departmentId)) {
      this.departmentMap.set(departmentId, new Set());
    }
    this.departmentMap.get(departmentId)!.add(agentId);
  }

  leaveDepartment(agentId: string, departmentId: string): void {
    this.departmentMap.get(departmentId)?.delete(agentId);
  }

  /**
   * Send a message from one agent to another (or broadcast).
   * Returns the message id.
   */
  async send(
    from: string,
    to: string | null,
    type: A2AMessageType,
    subject: string,
    content: string,
    opts?: { taskId?: string; replyTo?: string; department?: string }
  ): Promise<string> {
    const msg: A2AMessage = {
      id: generateId(),
      type,
      from,
      to,
      subject,
      content,
      taskId: opts?.taskId,
      replyTo: opts?.replyTo,
      department: opts?.department,
      ts: Date.now(),
    };

    // Keep rolling history
    this.history.push(msg);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Audit (non-blocking)
    getAuditTrail().log({
      action: "agent_a2a_message",
      agentId: from,
      taskId: opts?.taskId,
      payload: { type, to: to ?? "broadcast", subject },
      outcome: "success",
    });

    // Deliver
    if (to !== null) {
      // Direct message
      const handler = this.subscriptions.get(to);
      if (handler) {
        try { await handler(msg); } catch (e) { this.emit("error", e); }
      }
    } else {
      // Broadcast — deliver to all agents in dept (if specified) or all agents
      const targets = opts?.department
        ? [...(this.departmentMap.get(opts.department) ?? [])]
        : [...this.subscriptions.keys()];

      for (const agentId of targets) {
        if (agentId === from) continue; // don't echo back to sender
        const handler = this.subscriptions.get(agentId);
        if (handler) {
          try { await handler(msg); } catch (e) { this.emit("error", e); }
        }
      }
    }

    this.emit("message", msg);
    return msg.id;
  }

  /**
   * Convenience wrappers
   */
  async request(from: string, to: string, subject: string, content: string, taskId?: string) {
    return this.send(from, to, "request", subject, content, { taskId });
  }

  async respond(from: string, replyTo: A2AMessage, content: string) {
    return this.send(from, replyTo.from, "response", `Re: ${replyTo.subject}`, content, {
      taskId: replyTo.taskId,
      replyTo: replyTo.id,
    });
  }

  async handoff(from: string, to: string, subject: string, context: string, taskId?: string) {
    return this.send(from, to, "handoff", subject, context, { taskId });
  }

  async escalate(from: string, to: string, subject: string, context: string, taskId?: string) {
    return this.send(from, to, "escalate", subject, context, { taskId });
  }

  async share(from: string, department: string, subject: string, content: string, taskId?: string) {
    return this.send(from, null, "share", subject, content, { department, taskId });
  }

  /**
   * Read recent message history for a specific agent or all
   */
  getHistory(opts?: { agentId?: string; limit?: number }): A2AMessage[] {
    let msgs = this.history;
    if (opts?.agentId) {
      msgs = msgs.filter(m => m.from === opts.agentId || m.to === opts.agentId || m.to === null);
    }
    const limit = opts?.limit ?? 50;
    return msgs.slice(-limit);
  }

  getSubscribers(): string[] {
    return [...this.subscriptions.keys()];
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _bus: A2AMessageBus | null = null;

export function getA2ABus(): A2AMessageBus {
  if (!_bus) _bus = new A2AMessageBus();
  return _bus;
}
