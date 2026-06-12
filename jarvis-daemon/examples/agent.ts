/**
 * Build your own secure agent — the whole thing.
 *
 *   node --experimental-strip-types examples/agent.ts
 *
 * Needs a model. The default below uses Ollama (local, free, BYO nothing):
 *   1. install Ollama → https://ollama.com
 *   2. `ollama pull llama3.2`
 * Or swap in any LLMProvider (NVIDIA NIM, OpenAI-compatible, Google, …).
 */

import { createKernel, defineTool } from "../src/kernel.ts";
import { OllamaProvider } from "../src/llm/ollama.ts";

const kernel = createKernel({ llm: new OllamaProvider() });

// A harmless tool the agent can use freely (category run_code → auto-approved).
kernel.addTool(defineTool({
  name: "add",
  description: "Add two numbers",
  category: "run_code",
  inputSchema: { a: { type: "number" }, b: { type: "number" } },
  handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
}));

// A dangerous tool. category "delete_file" is a circuit breaker — the kernel
// will refuse to run it unattended unless you approve it. Try it: the agent
// cannot delete anything just because the prompt told it to.
kernel.addTool(defineTool({
  name: "delete_everything",
  description: "Delete a file",
  category: "delete_file",
  inputSchema: { path: { type: "string" } },
  handler: ({ path }) => ({ deleted: path }),
}));

const result = await kernel.run("What is 2 + 40? Use your tools.", {
  // Unattended-safe: deny anything that needs approval. Remove this and pass an
  // onApproval handler to wire approvals to a UI / Slack / CLI prompt.
  onApproval: () => false,
  onStep: ({ turn, text }) => console.log(`  [turn ${turn}] ${text.slice(0, 80)}`),
});

console.log("\nFINAL:", result.output);
console.log("(turns:", result.turns, " toolCalls:", result.toolCalls, ")");
