/**
 * Verify the learning memory — deterministic, no AI model needed.
 *   node --experimental-strip-types verify-learnings.ts
 */
import { initDatabase } from "./src/vault/schema.ts";
import { recordLearning, getLearnings, buildLearningPrefix, detectFrustration, detectPreference } from "./src/agents/learnings.ts";
await initDatabase();

let pass = 0; const fails: string[] = [];
const check = (name: string, cond: boolean) => { if (cond) pass++; else fails.push(name); console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

// ── Signal detectors (no DB) ──
check("frustration: 'this is wrong again'", detectFrustration("this is wrong again"));
check("frustration: 'not what I asked'", detectFrustration("that's not what I asked for"));
check("frustration: \"doesn't work\"", detectFrustration("it doesn't work"));
check("NO frustration: 'thanks, great'", !detectFrustration("thanks, that's great"));
check("preference: 'always keep it short'", detectPreference("always keep your answers short") !== null);
check("preference: 'from now on be concise'", detectPreference("from now on be concise") !== null);
check("NOT a pref: a long task", detectPreference("draft a 500 word blog post about marketing funnels for ecommerce brands and include three real examples") === null);

// ── Durable store (needs vault DB) ──
try {
  const A = "verify-agent-" + Date.now();
  recordLearning(A, "mistake", "Sent the email before getting approval");
  recordLearning(A, "mistake", "Sent the email before getting approval"); // dup → ignored
  recordLearning("user", "preference", "Keep replies under three sentences");
  const got = getLearnings(A, 20);
  check("recorded mistake is retrievable", got.some(g => g.text.includes("before getting approval")));
  check("dedupe: only one copy stored", got.filter(g => g.text.includes("before getting approval")).length === 1);
  check("global 'user' preference reaches the agent", got.some(g => g.kind === "preference" && g.text.includes("three sentences")));
  const prefix = buildLearningPrefix(A);
  check("prefix injects the mistake-to-avoid", prefix.includes("before getting approval"));
  check("prefix injects the preference", prefix.includes("three sentences"));
} catch (e) {
  fails.push("DB learnings threw: " + String(e));
  console.log("FAIL  DB learnings threw: " + String(e));
}

console.log(`\n${pass}/${pass + fails.length} passed`);
process.exit(fails.length ? 1 : 0);
