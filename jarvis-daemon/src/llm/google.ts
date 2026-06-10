/**
 * Google Gemini Provider
 */

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamChunk } from "./provider.ts";
import { estimateCost } from "./provider.ts";

export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  readonly defaultModel = "gemini-2.0-flash";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  private buildBody(messages: LLMMessage[], options: LLMOptions) {
    const systemMsg = messages.find(m => m.role === "system");
    const userMessages = messages.filter(m => m.role !== "system");

    const contents = userMessages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    return body;
  }

  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const model = options.model?.includes("gemini") ? options.model : this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildBody(messages, options)),
    });

    if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);

    const data = await res.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const content = data.candidates[0]?.content.parts.map(p => p.text).join("") ?? "";
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      content,
      model,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCost(model, inputTokens, outputTokens),
      },
      provider: this.name,
    };
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncGenerator<LLMStreamChunk> {
    const model = options.model?.includes("gemini") ? options.model : this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildBody(messages, options)),
    });

    if (!res.ok || !res.body) throw new Error(`Google stream ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        try {
          const evt = JSON.parse(raw) as {
            candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
            usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
          };

          const text = evt.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
          if (text) yield { delta: text, done: false };

          if (evt.usageMetadata) {
            inputTokens = evt.usageMetadata.promptTokenCount;
            outputTokens = evt.usageMetadata.candidatesTokenCount;
          }
        } catch { /* skip malformed */ }
      }
    }

    yield {
      delta: "",
      done: true,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCost(model, inputTokens, outputTokens),
      },
    };
  }
}
