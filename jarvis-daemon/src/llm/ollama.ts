import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamChunk } from "./provider.ts";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly defaultModel = "llama3.2:3b";
  private baseUrl: string;
  private resolvedModel: string | null = null;
  private installed: string[] | null = null;

  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a usable model name. If the caller specifies one, use it. Otherwise
   * pick from the models actually installed on this machine — preferring the
   * configured default, then the llama3.2 family, then whatever is first.
   * Makes Ollama "just work" regardless of what the user has pulled.
   */
  private async listInstalled(): Promise<string[]> {
    if (this.installed) return this.installed;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json() as { models?: Array<{ name: string }> };
        this.installed = (data.models ?? []).map(m => m.name);
        return this.installed;
      }
    } catch { /* ignore */ }
    this.installed = [];
    return this.installed;
  }

  private async resolveModel(requested?: string): Promise<string> {
    const names = await this.listInstalled();
    const pick = () =>
      names.find(n => n === this.defaultModel) ??
      names.find(n => n.startsWith("llama3.2")) ??
      names.find(n => n.startsWith("llama")) ??
      names[0] ?? this.defaultModel;
    if (requested) {
      // Use the requested model only if it's actually installed (exact or family prefix);
      // otherwise fall back gracefully so a missing model never breaks chat.
      if (names.includes(requested) || names.some(n => n.startsWith(requested))) return requested;
      return pick();
    }
    if (this.resolvedModel) return this.resolvedModel;
    this.resolvedModel = pick();
    return this.resolvedModel;
  }

  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const model = await this.resolveModel(options.model);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: "30m",
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 512,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

    const data = await res.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message.content,
      model,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        costUsd: 0,
      },
      provider: this.name,
    };
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncGenerator<LLMStreamChunk> {
    const model = await this.resolveModel(options.model);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages, stream: true,
        keep_alive: "30m",
        options: { temperature: options.temperature ?? 0.7 },
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Ollama stream ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const evt = JSON.parse(line) as {
            message?: { content: string };
            done: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (evt.message?.content) {
            yield { delta: evt.message.content, done: false };
          }
          if (evt.done) {
            yield {
              delta: "", done: true,
              usage: {
                inputTokens: evt.prompt_eval_count ?? 0,
                outputTokens: evt.eval_count ?? 0,
                costUsd: 0,
              },
            };
          }
        } catch { /* skip */ }
      }
    }
  }
}
