/**
 * OpenAI-compatible provider. One implementation covers OpenAI, DeepSeek, Groq,
 * and any other service that speaks the OpenAI /chat/completions format —
 * just a different base URL + default model.
 */

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamChunk } from "./provider.ts";
import { estimateCost } from "./provider.ts";

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  private apiKey: string;
  private baseUrl: string;
  private modelMatch: RegExp;

  constructor(opts: { name: string; apiKey: string; baseUrl: string; defaultModel: string; modelMatch: RegExp }) {
    this.name = opts.name;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.defaultModel = opts.defaultModel;
    this.modelMatch = opts.modelMatch;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  // Use the requested model only if it belongs to this provider; else our default.
  private resolveModel(model?: string): string {
    return model && this.modelMatch.test(model) ? model : this.defaultModel;
  }

  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const model = this.resolveModel(options.model);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
      }),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${await res.text()}`);

    const data = await res.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    return {
      content,
      model,
      usage: { inputTokens, outputTokens, costUsd: estimateCost(model, inputTokens, outputTokens) },
      provider: this.name,
    };
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncGenerator<LLMStreamChunk> {
    const model = this.resolveModel(options.model);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.7, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`${this.name} stream ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") { yield { delta: "", done: true }; return; }
        try {
          const evt = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const d = evt.choices?.[0]?.delta?.content;
          if (d) yield { delta: d, done: false };
        } catch { /* skip keep-alive lines */ }
      }
    }
  }
}

export function makeOpenAI(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name: "openai", apiKey, baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini", modelMatch: /^(gpt|o1|o3|chatgpt)/i,
  });
}

export function makeDeepseek(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name: "deepseek", apiKey, baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat", modelMatch: /deepseek/i,
  });
}

/**
 * NVIDIA NIM / API Catalog (build.nvidia.com) — OpenAI-compatible, free dev credits.
 * Serves Llama, DeepSeek, Nemotron, Qwen, etc. Model ids are vendor-prefixed
 * (e.g. "meta/llama-3.3-70b-instruct"), which is what modelMatch keys off.
 */
export function makeNvidia(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name: "nvidia", apiKey, baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
    modelMatch: /^(meta|nvidia|deepseek-ai|qwen|mistralai|google|microsoft|nv-mistralai)\//i,
  });
}
