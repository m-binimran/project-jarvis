/**
 * LLM Manager — multi-provider routing with fallback chain.
 * Inspired by usejarvis pattern. Written fresh.
 */

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamChunk } from "./provider.ts";
import { getDb, generateId, now } from "../vault/schema.ts";

const MAX_RETRIES = 2;
const TIMEOUT_MS = 90_000;

export class LLMManager {
  private providers = new Map<string, LLMProvider>();
  private primary = "";
  private fallback: string[] = [];

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
    if (!this.primary) this.primary = provider.name;
  }

  setPrimary(name: string): void {
    if (!this.providers.has(name)) throw new Error(`Provider '${name}' not registered`);
    this.primary = name;
  }

  setFallback(names: string[]): void {
    this.fallback = names.filter(n => this.providers.has(n));
  }

  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  private sequence(override?: string): string[] {
    const first = override && this.providers.has(override) ? override : this.primary;
    return [first, ...this.fallback.filter(n => n !== first)];
  }

  async complete(
    messages: LLMMessage[],
    options: LLMOptions & { conversationId?: string; agentId?: string; providerOverride?: string } = {}
  ): Promise<LLMResponse> {
    const seq = this.sequence(options.providerOverride);
    const errors: string[] = [];

    for (const name of seq) {
      const provider = this.providers.get(name)!;
      if (!await provider.isAvailable()) {
        errors.push(`${name}: unavailable`);
        continue;
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          const result = await provider.complete(messages, options);
          clearTimeout(timer);

          // Log usage
          this.logUsage(result, options.conversationId, options.agentId);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt === MAX_RETRIES) errors.push(`${name}: ${msg}`);
        }
      }
    }

    throw new Error(`All LLM providers failed:\n${errors.join("\n")}`);
  }

  async *stream(
    messages: LLMMessage[],
    options: LLMOptions & { conversationId?: string; agentId?: string; providerOverride?: string } = {}
  ): AsyncGenerator<LLMStreamChunk> {
    const seq = this.sequence(options.providerOverride);

    for (const name of seq) {
      const provider = this.providers.get(name)!;
      if (!await provider.isAvailable()) continue;

      try {
        let lastUsage: LLMStreamChunk["usage"];
        for await (const chunk of provider.stream(messages, options)) {
          if (chunk.usage) lastUsage = chunk.usage;
          yield chunk;
        }
        if (lastUsage) {
          this.logUsage(
            { model: options.model ?? provider.defaultModel, usage: lastUsage, provider: name, content: "" },
            options.conversationId,
            options.agentId
          );
        }
        return;
      } catch { continue; }
    }

    throw new Error("All providers failed to stream");
  }

  private logUsage(
    result: Pick<LLMResponse, "model" | "usage" | "provider" | "content">,
    conversationId?: string,
    agentId?: string
  ): void {
    try {
      const db = getDb();
      db.run(
        `INSERT INTO usage_stats(id,conversation_id,agent_id,model,input_tokens,output_tokens,cost_usd,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [
          generateId(),
          conversationId ?? null,
          agentId ?? null,
          result.model,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.costUsd,
          now(),
        ]
      );
    } catch { /* non-fatal — don't break the response */ }
  }

  // ── Usage summary for token bar ──────────────────────────────────────────

  getTodayUsage(): { tokens: number; costUsd: number } {
    const db = getDb();
    const midnight = new Date(); midnight.setHours(0,0,0,0);
    const row = db.query<{ tokens: number; cost: number }, [number]>(`
      SELECT COALESCE(SUM(input_tokens+output_tokens),0) as tokens,
             COALESCE(SUM(cost_usd),0) as cost
      FROM usage_stats WHERE created_at >= ?
    `).get(midnight.getTime());
    return { tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0 };
  }

  getUsageByConversation(conversationId: string): { tokens: number; costUsd: number } {
    const db = getDb();
    const row = db.query<{ tokens: number; cost: number }, [string]>(`
      SELECT COALESCE(SUM(input_tokens+output_tokens),0) as tokens,
             COALESCE(SUM(cost_usd),0) as cost
      FROM usage_stats WHERE conversation_id = ?
    `).get(conversationId);
    return { tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0 };
  }
}
