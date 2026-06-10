/**
 * JARVIS Workflow Storage & Execution
 *
 * Workflows are saved as JSON graphs (nodes + edges).
 * Execution walks the graph topologically:
 *   trigger → action(s) → output(s)
 *
 * V1 execution is linear (chain) — parallel branches in V2.
 */

import { getDb, generateId, now } from "./schema.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: "trigger" | "action" | "output";
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  status: "saved" | "active" | "disabled";
  lastRunAt?: number;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function saveWorkflow(workflow: {
  id?: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): WorkflowRecord {
  const db = getDb();
  const id = workflow.id ?? generateId();
  const definition = JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges });
  const ts = now();

  const existing = db.query<{ id: string }>(
    "SELECT id FROM workflows WHERE id = ?"
  ).get(id);

  if (existing) {
    db.run(
      "UPDATE workflows SET name=?, definition=?, updated_at=? WHERE id=?",
      [workflow.name, definition, ts, id]
    );
  } else {
    db.run(
      `INSERT INTO workflows(id,name,definition,status,run_count,created_at,updated_at)
       VALUES(?,?,?,?,0,?,?)`,
      [id, workflow.name, definition, "saved", ts, ts]
    );
  }

  return getWorkflow(id)!;
}

export function getWorkflow(id: string): WorkflowRecord | null {
  const db = getDb();
  const row = db.query<{
    id: string;
    name: string;
    definition: string;
    status: string;
    last_run_at: number | null;
    run_count: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM workflows WHERE id = ?").get(id);

  if (!row) return null;
  return rowToRecord(row);
}

export function listWorkflows(): WorkflowRecord[] {
  const db = getDb();
  const rows = db.query<{
    id: string;
    name: string;
    definition: string;
    status: string;
    last_run_at: number | null;
    run_count: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM workflows ORDER BY updated_at DESC").all();

  return rows.map(rowToRecord);
}

function rowToRecord(row: {
  id: string;
  name: string;
  definition: string;
  status: string;
  last_run_at: number | null;
  run_count: number;
  created_at: number;
  updated_at: number;
}): WorkflowRecord {
  return {
    id: row.id,
    name: row.name,
    definition: JSON.parse(row.definition),
    status: row.status as WorkflowRecord["status"],
    lastRunAt: row.last_run_at ?? undefined,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Execution ─────────────────────────────────────────────────────────────────

export interface WorkflowRunResult {
  runId: string;
  success: boolean;
  output: string;
  error?: string;
  stepResults: Array<{ nodeId: string; type: string; output: string }>;
}

/**
 * Execute a workflow by walking the node graph.
 *
 * V1: linear chain execution (trigger → action → output).
 * The `dispatch` callback runs each action node through the orchestrator.
 */
export async function executeWorkflow(
  workflowId: string,
  input: unknown,
  dispatch: (agentId: string, prompt: string) => Promise<string>
): Promise<WorkflowRunResult> {
  const db = getDb();
  const workflow = getWorkflow(workflowId);

  if (!workflow) {
    return { runId: "none", success: false, output: "", error: "Workflow not found", stepResults: [] };
  }

  const runId = generateId();
  const startedAt = now();

  // Log run start
  db.run(
    `INSERT INTO workflow_runs(id,workflow_id,status,input,started_at) VALUES(?,?,?,?,?)`,
    [runId, workflowId, "running", JSON.stringify(input), startedAt]
  );

  const stepResults: WorkflowRunResult["stepResults"] = [];
  let lastOutput = "";

  try {
    // Topological walk: start from trigger nodes, follow edges
    const { nodes, edges } = workflow.definition;

    // Build adjacency list
    const nextNodes = new Map<string, string[]>();
    for (const edge of edges) {
      if (!nextNodes.has(edge.source)) nextNodes.set(edge.source, []);
      nextNodes.get(edge.source)!.push(edge.target);
    }

    // Find trigger node(s) as starting points
    const triggerNodes = nodes.filter(n => n.type === "trigger");
    if (triggerNodes.length === 0) {
      throw new Error("No trigger node found in workflow");
    }

    // BFS traversal
    const visited = new Set<string>();
    const queue: string[] = triggerNodes.map(n => n.id);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;

      let nodeOutput = "";

      if (node.type === "trigger") {
        nodeOutput = `Triggered: ${node.data.label ?? "manual"} — Input: ${JSON.stringify(input) ?? "none"}`;
        lastOutput = String(input) || String(node.data.label ?? "trigger");
      }

      if (node.type === "action") {
        const agentId = String(node.data.agentId ?? "jarvis");
        const prompt = node.data.prompt
          ? `${node.data.prompt}\n\nContext: ${lastOutput}`
          : lastOutput;

        nodeOutput = await dispatch(agentId, prompt);
        lastOutput = nodeOutput;
      }

      if (node.type === "output") {
        const outputType = String(node.data.outputType ?? "display");
        nodeOutput = `[${outputType}] ${lastOutput}`;
        // V1: display is the only implemented output — file/notify in V2
      }

      stepResults.push({ nodeId, type: node.type, output: nodeOutput });

      // Enqueue next nodes
      for (const nextId of nextNodes.get(nodeId) ?? []) {
        if (!visited.has(nextId)) queue.push(nextId);
      }
    }

    // Update run record
    db.run(
      "UPDATE workflow_runs SET status=?,output=?,finished_at=? WHERE id=?",
      ["completed", lastOutput.slice(0, 4000), now(), runId]
    );

    // Update workflow stats
    db.run(
      "UPDATE workflows SET run_count=run_count+1, last_run_at=? WHERE id=?",
      [now(), workflowId]
    );

    return { runId, success: true, output: lastOutput, stepResults };
  } catch (err) {
    const errorMsg = String(err);
    db.run(
      "UPDATE workflow_runs SET status=?,error=?,finished_at=? WHERE id=?",
      ["failed", errorMsg, now(), runId]
    );

    return { runId, success: false, output: "", error: errorMsg, stepResults };
  }
}
