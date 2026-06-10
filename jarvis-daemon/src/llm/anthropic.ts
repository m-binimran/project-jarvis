import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamChunk } from "./provider.ts";
import { estimateCost } from "./provider.ts";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel = "claude-sonnet-4-5";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const model = options.model?.includes("claude") ? options.model : this.defaultModel;
    const system = options.systemPrompt ?? messages.find(m => m.role === "system")?.content;
    const userMessages = messages.filter(m => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      messages: userMessages,
    };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    const content = data.content.filter(c => c.type === "text").map(c => c.text).join("");
    const usage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      costUsd: estimateCost(model, data.usage.input_tokens, data.usage.output_tokens),
    };

    return { content, model, usage, provider: this.name };
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncGenerator<LLMStreamChunk> {
    const model = options.model?.includes("claude") ? options.model : this.defaultModel;
    const system = options.systemPrompt ?? messages.find(m => m.role === "system")?.content;
    const userMessages = messages.filter(m => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      messages: userMessages,
    };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Anthropic stream ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;

        try {
          const evt = JSON.parse(raw) as {
            type: string;
            delta?: { type: string; text?: string };
            message?: { usage: { input_tokens: number; output_tokens: number } };
            usage?: { output_tokens: number };
          };

          if (evt.type === "content_block_delta" && evt.delta?.text) {
            yield { delta: evt.delta.text, done: false };
          }
          if (evt.type === "message_start" && evt.message?.usage) {
            inputTokens = evt.message.usage.input_tokens;
          }
          if (evt.type === "message_delta" && evt.usage) {
            outputTokens = evt.usage.output_tokens;
          }
          if (evt.type === "message_stop") {
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
        } catch { /* skip malformed SSE lines */ }
      }
    }
  }
}
