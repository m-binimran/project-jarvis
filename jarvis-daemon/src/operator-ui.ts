/**
 * Operator control panel — a tiny self-contained page served at GET /operator.
 *
 * It's intentionally dependency-free (vanilla HTML/JS, same-origin to the daemon)
 * so it's easy to verify and can't break the orb/overlay. You start a computer-use
 * task here, watch each proposed action, and Approve / Reject / Stop. The actual
 * clicking is done by the overlay; this is just the human-in-the-loop surface.
 */
export const OPERATOR_UI = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS — Computer-use Operator</title>
<style>
  :root { --bg:#0b0f0e; --card:#141a19; --line:#243230; --tiff:#0ABAB5; --amber:#FFB020; --txt:#e7f0ee; --dim:#8aa39d; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:15px/1.5 system-ui,Segoe UI,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:28px 20px; }
  h1 { font-size:19px; margin:0 0 4px; } .sub { color:var(--dim); margin:0 0 20px; font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:14px; }
  input[type=text] { width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:#0e1413; color:var(--txt); font-size:15px; }
  button { cursor:pointer; border:0; border-radius:10px; padding:10px 16px; font-size:14px; font-weight:600; color:#04110f; }
  .run { background:var(--tiff); width:100%; margin-top:10px; }
  .ok { background:var(--tiff); } .no { background:#ff5d5d; color:#1a0606; } .stop { background:#2c3a38; color:var(--txt); }
  .row { display:flex; gap:10px; margin-top:12px; } .row button { flex:1; }
  .status { font-size:13px; color:var(--dim); margin-bottom:8px; }
  .act { font-size:17px; font-weight:600; color:var(--amber); margin:6px 0; }
  .thought { color:var(--dim); font-size:14px; }
  .pill { display:inline-block; font-size:12px; padding:2px 9px; border-radius:999px; background:#0e1413; border:1px solid var(--line); color:var(--dim); }
  .hide { display:none; }
</style></head>
<body><div class="wrap">
  <h1>Computer-use Operator</h1>
  <p class="sub">JARVIS proposes one action at a time. Nothing runs without your OK. Watch your screen — the proposed spot is circled in amber.</p>

  <div class="card">
    <input id="task" type="text" placeholder="e.g. open the display settings" autocomplete="off">
    <button class="run" id="run">Run task</button>
  </div>

  <div class="card hide" id="panel">
    <div class="status"><span class="pill" id="pill">idle</span> &nbsp;step <span id="step">0</span></div>
    <div id="proposed" class="hide">
      <div class="act" id="actText"></div>
      <div class="thought" id="thought"></div>
      <div class="row">
        <button class="ok" id="approve">Approve</button>
        <button class="no" id="reject">Reject</button>
      </div>
    </div>
    <div id="done" class="thought hide"></div>
    <div class="row"><button class="stop" id="stop">Stop session</button></div>
  </div>
</div>
<script>
  const $ = id => document.getElementById(id);
  let sid = null, timer = null;
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: body ? { "Content-Type":"application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({}));
  }
  $("run").onclick = async () => {
    const task = $("task").value.trim(); if (!task) return;
    const res = await api("POST","/api/operator/start",{ task });
    sid = res.id; $("panel").classList.remove("hide"); poll();
    if (timer) clearInterval(timer); timer = setInterval(poll, 1000);
  };
  $("approve").onclick = () => sid && api("POST","/api/operator/"+sid+"/approve").then(poll);
  $("reject").onclick  = () => sid && api("POST","/api/operator/"+sid+"/reject").then(poll);
  $("stop").onclick    = () => sid && api("POST","/api/operator/"+sid+"/stop").then(poll);
  async function poll() {
    if (!sid) return;
    const s = await api("GET","/api/operator/"+sid);
    if (!s || s.error) return;
    $("pill").textContent = s.status; $("step").textContent = s.step + "/" + s.maxSteps;
    const awaiting = s.status === "awaiting_approval" && s.proposed;
    $("proposed").classList.toggle("hide", !awaiting);
    if (awaiting) { $("actText").textContent = s.proposed.describe; $("thought").textContent = s.proposed.thought || ""; }
    const ended = ["done","stopped","error"].includes(s.status);
    $("done").classList.toggle("hide", !ended);
    if (ended) { $("done").textContent = s.error ? ("Error: " + s.error) : (s.result || "Finished."); if (timer) clearInterval(timer); }
  }
</script>
</body></html>`;
