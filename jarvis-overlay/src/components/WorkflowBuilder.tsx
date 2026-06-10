/**
 * JARVIS Workflow Builder
 *
 * Visual drag-and-drop canvas for building automation workflows.
 * Built on @xyflow/react (React Flow v12).
 *
 * Node types:
 *   trigger  — what kicks the workflow off (schedule, message match, etc.)
 *   action   — what JARVIS does (run agent, call MCP tool, send message)
 *   output   — what to do with the result (save to file, display, notify)
 *
 * Workflow is stored as JSON in the daemon via POST /api/workflows.
 * Run sends the workflow to POST /api/workflows/:id/run.
 */

import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const DAEMON_URL = 'http://127.0.0.1:9101'

// ── Node data types ──────────────────────────────────────────────────────────

interface TriggerData { label: string; triggerType: 'manual' | 'schedule' | 'message' }
interface ActionData  { label: string; agentId: string; prompt: string }
interface OutputData  { label: string; outputType: 'display' | 'file' | 'notify' }

// ── Custom node components ────────────────────────────────────────────────────

function TriggerNode({ data }: { data: TriggerData }) {
  return (
    <div className="wf-node wf-trigger">
      <div className="wf-node-header">⚡ Trigger</div>
      <div className="wf-node-label">{data.label}</div>
      <div className="wf-node-sub">{data.triggerType}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function ActionNode({ data }: { data: ActionData }) {
  return (
    <div className="wf-node wf-action">
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header">🤖 Action</div>
      <div className="wf-node-label">{data.label}</div>
      <div className="wf-node-sub">{data.agentId}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function OutputNode({ data }: { data: OutputData }) {
  return (
    <div className="wf-node wf-output">
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header">📤 Output</div>
      <div className="wf-node-label">{data.label}</div>
      <div className="wf-node-sub">{data.outputType}</div>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode as any,
  action:  ActionNode as any,
  output:  OutputNode as any,
}

// ── Default starter workflow ──────────────────────────────────────────────────

const defaultNodes: Node[] = [
  {
    id: '1',
    type: 'trigger',
    position: { x: 140, y: 30 },
    data: { label: 'Manual trigger', triggerType: 'manual' },
  },
  {
    id: '2',
    type: 'action',
    position: { x: 100, y: 150 },
    data: { label: 'Run JARVIS', agentId: 'jarvis', prompt: 'Process the trigger input' },
  },
  {
    id: '3',
    type: 'output',
    position: { x: 110, y: 280 },
    data: { label: 'Display result', outputType: 'display' },
  },
]

const defaultEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3', animated: true },
]

// ── Node palette templates ─────────────────────────────────────────────────────

const TRIGGER_TEMPLATES = [
  { label: 'Manual trigger', triggerType: 'manual' as const },
  { label: 'Daily at 9am',   triggerType: 'schedule' as const },
  { label: 'Message match',  triggerType: 'message' as const },
]

const ACTION_TEMPLATES = [
  { label: 'Run JARVIS',      agentId: 'jarvis',       prompt: '' },
  { label: 'Research topic',  agentId: 'research-agent', prompt: '' },
  { label: 'Write content',   agentId: 'content-enterprise', prompt: '' },
  { label: 'Manage tasks',    agentId: 'project-agent', prompt: '' },
  { label: 'Run CEO',         agentId: 'ceo',           prompt: '' },
]

const OUTPUT_TEMPLATES = [
  { label: 'Display result', outputType: 'display' as const },
  { label: 'Save to file',   outputType: 'file' as const },
  { label: 'Notify me',      outputType: 'notify' as const },
]

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowBuilder() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges)

  const [workflowName, setWorkflowName] = useState('My Workflow')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [running, setRunning] = useState(false)

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge({ ...connection, animated: true }, eds)),
    [setEdges]
  )

  let nodeIdCounter = nodes.length + 1
  const nextId = () => String(++nodeIdCounter)

  const addNode = (type: 'trigger' | 'action' | 'output', data: Record<string, unknown>) => {
    const id = nextId()
    const y = type === 'trigger' ? 30 : type === 'action' ? 150 : 280
    setNodes(prev => [
      ...prev,
      { id, type, position: { x: 40 + Math.random() * 120, y }, data } as Node
    ])
  }

  const saveWorkflow = async () => {
    setStatus('Saving…')
    const workflow = {
      id: savedId ?? undefined,
      name: workflowName,
      nodes: nodes.map(n => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    }
    try {
      const res = await fetch(`${DAEMON_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      })
      const data = await res.json()
      setSavedId(data.id)
      setStatus('Saved ✓')
      setTimeout(() => setStatus(''), 2000)
    } catch {
      setStatus('Save failed — daemon offline?')
    }
  }

  const runWorkflow = async () => {
    if (!savedId) {
      await saveWorkflow()
    }
    setRunning(true)
    setStatus('Running…')
    try {
      const res = await fetch(`${DAEMON_URL}/api/workflows/${savedId ?? 'latest'}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: null }),
      })
      const data = await res.json()
      setStatus(data.success ? 'Done ✓' : `Failed: ${data.error ?? 'unknown'}`)
      setTimeout(() => setStatus(''), 3000)
    } catch {
      setStatus('Run failed — daemon offline?')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="workflow-builder">
      {/* Toolbar */}
      <div className="wf-toolbar">
        <input
          className="wf-name-input"
          value={workflowName}
          onChange={e => setWorkflowName(e.target.value)}
          placeholder="Workflow name"
        />
        {status && <span className="wf-status">{status}</span>}
        <div className="wf-toolbar-actions">
          <button className="wf-btn save" onClick={saveWorkflow}>Save</button>
          <button className="wf-btn run" onClick={runWorkflow} disabled={running}>
            {running ? '…' : '▶ Run'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="wf-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          style={{ background: '#080b12' }}
        >
          <Background color="#1e293b" gap={20} />
          <Controls style={{ background: '#1e293b', border: '1px solid #334155' }} />
        </ReactFlow>
      </div>

      {/* Node palette */}
      <div className="wf-palette">
        <div className="wf-palette-section">
          <div className="wf-palette-label">Triggers</div>
          {TRIGGER_TEMPLATES.map(t => (
            <button
              key={t.label}
              className="wf-palette-item trigger"
              onClick={() => addNode('trigger', t)}
            >
              ⚡ {t.label}
            </button>
          ))}
        </div>
        <div className="wf-palette-section">
          <div className="wf-palette-label">Actions</div>
          {ACTION_TEMPLATES.map(t => (
            <button
              key={t.label}
              className="wf-palette-item action"
              onClick={() => addNode('action', t)}
            >
              🤖 {t.label}
            </button>
          ))}
        </div>
        <div className="wf-palette-section">
          <div className="wf-palette-label">Outputs</div>
          {OUTPUT_TEMPLATES.map(t => (
            <button
              key={t.label}
              className="wf-palette-item output"
              onClick={() => addNode('output', t)}
            >
              📤 {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
