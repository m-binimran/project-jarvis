/**
 * LLM Provider interface — every model adapter implements this.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: LLMUsage;
  provider: string;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  usage?: LLMUsage;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  isAvailable(): Promise<boolean>;
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<LLMStreamChunk>;
}

// Cost per 1M tokens (approximate, updated May 2026)
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5":         { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-5":       { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5":        { input: 0.25,  output: 1.25  },
  "claude-3-5-haiku-latest": { input: 0.25,  output: 1.25  },
  "gpt-4o":                  { input: 2.5,   output: 10.0  },
  "gpt-4o-mini":             { input: 0.15,  output: 0.6   },
  "gemini-2.0-flash":        { input: 0.075, output: 0.30  },
  "gemini-2.0-flash-lite":   { input: 0.0,   output: 0.0   }, // free tier
  "gemini-1.5-pro":          { input: 1.25,  output: 5.0   },
  "gemini-1.5-flash":        { input: 0.075, output: 0.30  },
  "ollama/*":                { input: 0,     output: 0     }, // local = free
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = model.startsWith("ollama/") ? "ollama/*" : model;
  const rates = MODEL_COSTS[key] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}
