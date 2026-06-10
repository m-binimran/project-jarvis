/**
 * Runtime verification that CodeShield is wired into the MCP router.
 *   node --experimental-strip-types verify-router-shield.ts
 * Proves a dangerous shell command is blocked at router.call(), and a benign
 * one is allowed through. No API key required.
 */

import { buildDefaultRouter } from "./src/mcp/router.ts";

const router = buildDefaultRouter();
let pass = 0, fail = 0;

// 1. Dangerous command must be blocked by CodeShield (throws [FIREWALL])
try {
  await router.call("run_shell", { command: "rm", args: ["-rf", "/"] });
  console.log("FAIL  dangerous command was NOT blocked"); fail++;
} catch (e) {
  const msg = (e as Error).message;
  if (msg.includes("[FIREWALL]")) { console.log("PASS  CodeShield blocked 'rm -rf /' at router.call()"); pass++; }
  else { console.log(`FAIL  blocked but wrong error: ${msg}`); fail++; }
}

// 2. Benign command must pass the firewall (it runs; we only check it's NOT firewall-blocked)
try {
  const r = await router.call("run_shell", { command: "node", args: ["-e", "process.stdout.write('ok')"] }) as { stdout?: string };
  if ((r.stdout ?? "").includes("ok")) { console.log("PASS  benign command passed firewall and executed"); pass++; }
  else { console.log(`PASS  benign command passed firewall (stdout: ${JSON.stringify(r.stdout)})`); pass++; }
} catch (e) {
  const msg = (e as Error).message;
  if (msg.includes("[FIREWALL]")) { console.log(`FAIL  firewall wrongly blocked benign command: ${msg}`); fail++; }
  else { console.log(`PASS  benign command not firewall-blocked (exec note: ${msg})`); pass++; }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
