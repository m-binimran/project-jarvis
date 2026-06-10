/**
 * JARVIS Rate Limiter
 *
 * Token-bucket rate limiting per agent.
 * Persisted in SQLite so limits survive restarts.
 * Prevents runaway agents from burning API budget.
 */

import { getDb, now } from "../vault/schema.ts";

export interface RateLimitConfig {
  agentId: string;
  windowMs: number;    // Rolling window in ms
  maxTokens: number;   // Max tokens per window
  maxCalls: number;    // Max LLM calls per window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: { tokens: number; calls: number };
  resetAt: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  constructor(config: RateLimitConfig) { this.config = config; }

  /**
   * Check + consume. Returns allowed=false if over limit.
   * Uses SQLite upsert to track usage atomically.
   */
  consume(tokensUsed = 0): RateLimitResult {
    const db = getDb();
    const { agentId, windowMs, maxTokens, maxCalls } = this.config;
    const windowStart = now() - windowMs;

    // Get or create bucket
    let row = db.query<{
      agent_id: string; window_start: number;
      tokens_used: number; calls_made: number;
    }, [string]>(
      `SELECT * FROM rate_limit_buckets WHERE agent_id = ?`
    ).get(agentId);

    // Expired window — reset
    if (!row || row.window_start < windowStart) {
      db.run(
        `INSERT INTO rate_limit_buckets(agent_id,window_start,tokens_used,calls_made)
         VALUES(?,?,0,0)
         ON CONFLICT(agent_id) DO UPDATE SET
           window_start=excluded.window_start,
           tokens_used=0,
           calls_made=0`,
        [agentId, now()]
      );
      row = { agent_id: agentId, window_start: now(), tokens_used: 0, calls_made: 0 };
    }

    const newTokens = row.tokens_used + tokensUsed;
    const newCalls = row.calls_made + 1;
    const resetAt = row.window_start + windowMs;

    if (newTokens > maxTokens || newCalls > maxCalls) {
      return {
        allowed: false,
        remaining: {
          tokens: Math.max(0, maxTokens - row.tokens_used),
          calls: Math.max(0, maxCalls - row.calls_made),
        },
        resetAt,
      };
    }

    // Consume
    db.run(
      `UPDATE rate_limit_buckets SET tokens_used=?, calls_made=? WHERE agent_id=?`,
      [newTokens, newCalls, agentId]
    );

    return {
      allowed: true,
      remaining: {
        tokens: maxTokens - newTokens,
        calls: maxCalls - newCalls,
      },
      resetAt,
    };
  }

  reset(): void {
    const db = getDb();
    db.run(`DELETE FROM rate_limit_buckets WHERE agent_id=?`, [this.config.agentId]);
  }
}

// Default rate limits per agent tier
export const DEFAULT_LIMITS: Omit<RateLimitConfig, "agentId"> = {
  windowMs: 60 * 60 * 1000,  // 1 hour window
  maxTokens: 100_000,          // 100k tokens/hour per agent
  maxCalls: 200,               // 200 LLM calls/hour per agent
};
