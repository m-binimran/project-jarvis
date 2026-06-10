const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outputPath = path.join(require('os').homedir(), 'Desktop', 'JARVIS-Build-Plan.pdf');
const doc = new PDFDocument({ margin: 50, size: 'A4' });
doc.pipe(fs.createWriteStream(outputPath));

// ── Colours ──────────────────────────────────────────────────────────────────
const CYAN   = '#06b6d4';
const DARK   = '#0a0a0f';
const WHITE  = '#ffffff';
const LIGHT  = '#e2e8f0';
const MUTED  = '#94a3b8';
const BG2    = '#1e293b';

// ── Helpers ───────────────────────────────────────────────────────────────────
function coverPage() {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
  // Glow circle
  doc.circle(doc.page.width / 2, 220, 90).fillOpacity(0.12).fill(CYAN);
  doc.circle(doc.page.width / 2, 220, 60).fillOpacity(0.18).fill(CYAN);
  doc.circle(doc.page.width / 2, 220, 36).fillOpacity(1).fill(CYAN);
  // J
  doc.fillColor(DARK).fontSize(40).font('Helvetica-Bold')
     .text('J', doc.page.width / 2 - 12, 200);
  // Title
  doc.fillColor(WHITE).fontSize(36).font('Helvetica-Bold')
     .text('JARVIS', 0, 330, { align: 'center' });
  doc.fillColor(CYAN).fontSize(14).font('Helvetica')
     .text('Complete Build Plan', 0, 375, { align: 'center' });
  doc.fillColor(MUTED).fontSize(10)
     .text('The AI Operating System', 0, 400, { align: 'center' });
  // Divider
  doc.moveTo(150, 430).lineTo(doc.page.width - 150, 430).strokeColor(CYAN).lineWidth(1).stroke();
  // Meta
  doc.fillColor(MUTED).fontSize(9)
     .text('Confidential — Co-Founder Reference Document', 0, 445, { align: 'center' })
     .text('Version 2.0 · May 2026', 0, 460, { align: 'center' });
  doc.addPage();
}

function sectionHeader(title) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.5);
  doc.rect(50, doc.y, doc.page.width - 100, 28).fill(CYAN);
  doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
     .text(title, 58, doc.y - 22);
  doc.moveDown(1);
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica');
}

function h2(title) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  doc.moveDown(0.6);
  doc.fillColor(CYAN).fontSize(12).font('Helvetica-Bold').text(title);
  doc.moveDown(0.3);
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica');
}

function h3(title) {
  if (doc.y > doc.page.height - 60) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text(title);
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica');
}

function body(text) {
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica').text(text, { lineGap: 3 });
  doc.moveDown(0.3);
}

function bullet(text) {
  doc.fillColor(CYAN).fontSize(10).text('•  ', { continued: true });
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica').text(text, { lineGap: 2 });
}

function codeBlock(lines) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  doc.moveDown(0.3);
  const startY = doc.y;
  const lineH = 14;
  const blockH = lines.length * lineH + 16;
  doc.rect(50, startY, doc.page.width - 100, blockH).fill('#0f172a');
  doc.fillColor('#a5f3fc').fontSize(8.5).font('Courier');
  lines.forEach((line, i) => {
    doc.text(line, 60, startY + 8 + i * lineH);
  });
  doc.y = startY + blockH + 6;
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica');
}

function table(headers, rows, colWidths) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  doc.moveDown(0.3);
  const startX = 50;
  const rowH = 18;
  let y = doc.y;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  // Header row
  doc.rect(startX, y, totalW, rowH).fill(BG2);
  let x = startX;
  headers.forEach((h, i) => {
    doc.fillColor(CYAN).fontSize(8.5).font('Helvetica-Bold').text(h, x + 4, y + 5, { width: colWidths[i] - 8 });
    x += colWidths[i];
  });
  y += rowH;

  // Data rows
  rows.forEach((row, ri) => {
    if (y > doc.page.height - 40) {
      doc.addPage();
      y = doc.y;
    }
    doc.rect(startX, y, totalW, rowH).fill(ri % 2 === 0 ? '#111827' : '#0f172a');
    x = startX;
    row.forEach((cell, i) => {
      doc.fillColor(LIGHT).fontSize(8).font('Helvetica').text(String(cell), x + 4, y + 5, { width: colWidths[i] - 8 });
      x += colWidths[i];
    });
    y += rowH;
  });

  doc.y = y + 6;
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica');
}

function pageFooter() {
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).fontSize(8)
       .text('JARVIS — Confidential Build Plan', 50, doc.page.height - 35, { align: 'left', width: 300 });
    doc.fillColor(CYAN).fontSize(8)
       .text(`Page ${i}`, 0, doc.page.height - 35, { align: 'right', width: doc.page.width - 50 });
    doc.moveTo(50, doc.page.height - 42).lineTo(doc.page.width - 50, doc.page.height - 42)
       .strokeColor(BG2).lineWidth(0.5).stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────────────────────────────────────

doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
coverPage();
doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);

// ── WHAT WE'RE BUILDING ──────────────────────────────────────────────────────
sectionHeader('1. WHAT WE ARE BUILDING');
body('JARVIS is a desktop AI operating system. It sits on your screen as a floating overlay, follows your cursor, watches how you work, and executes tasks for you — using any AI model you choose, local or cloud.');
body('No terminal. No technical setup. No subscriptions forced on the user. Everything runs on their own machine.');

// ── CORE FEATURES ────────────────────────────────────────────────────────────
sectionHeader('2. THE TWO CORE FEATURES');

h2('Feature 1 — Cursor Toggle Overlay');
body('A floating bubble that lives near your cursor at all times. Always one click away. Works on top of every application on your computer — browser, Excel, email, anything.');
h3('How it works technically:');
bullet('Electron BrowserWindow with transparent: true, frame: false, alwaysOnTop: screen-saver');
bullet('setInterval every 200ms checks cursor position via screen.getCursorScreenPoint()');
bullet('If cursor moves more than 40px, the window follows');
bullet('Click bubble → window expands from 70px to 420px sidebar');
bullet('Alt+J global shortcut toggles open/close from anywhere');
h3('What the user experiences:');
bullet('J bubble floats near them all day');
bullet('One click or Alt+J opens the full assistant');
bullet('Closes instantly, returns to bubble');
bullet('Never interrupts their workflow');
body('Why this beats everything else: Every other AI tool makes you stop what you are doing and switch context. JARVIS is already where you are.');

doc.moveDown(0.5);
h2('Feature 2 — Watch Me Work (Recording + Playbook)');
body('You do something once. JARVIS records every step. It generates a playbook. Next time JARVIS does it for you — or you hand the playbook to a new staff member.');
h3('How it works technically:');
bullet('User clicks Record in the sidebar');
bullet('desktopCapturer takes screenshots every 500ms');
bullet('Action logger records: mouse clicks, keyboard inputs, active window, URLs, files opened');
bullet('On Stop: all frames and actions sent to AI model');
bullet('AI analyses the sequence and writes a structured SOP');
bullet('Playbook stored in local SQLite with steps, screenshots, and automation hooks');
bullet('User can run the playbook: JARVIS executes each step automatically');
h3('What the user experiences:');
bullet('Click Record, do your task normally');
bullet('Click Stop');
bullet('Playbook appears: Step 1: Open Gmail. Step 2: Click Compose...');
bullet('One click to run it automatically next time');
bullet('Export as PDF guide for staff training');
body('Why this beats everything else: No other AI tool eliminates the cost of teaching. JARVIS watches you once and never asks again.');

// ── MODEL FLEXIBILITY ─────────────────────────────────────────────────────────
sectionHeader('3. MODEL FLEXIBILITY — LOCAL OR API');
body('On first launch, JARVIS asks: "How do you want to power your AI?" Users choose their AI engine on first setup and can switch any time from settings.');

h2('Local Models (Private, No Cost, Works Offline)');
body('Powered by Ollama running silently in the background.');
table(
  ['Model', 'RAM Needed', 'Best For'],
  [
    ['Llama 3.1 8B', '8 GB', 'Everyday tasks, fast responses'],
    ['Llama 3.1 70B', '40 GB', 'Complex reasoning, long documents'],
    ['Mistral 7B', '8 GB', 'Speed-focused tasks'],
    ['Phi-3 Mini', '4 GB', 'Low-spec machines'],
    ['Gemma 2 9B', '8 GB', 'Balanced all-rounder'],
  ],
  [150, 100, 230]
);

h2('API Models (Best Quality, Pay Per Use)');
body('User enters their own API key. We never store it, never see it.');
table(
  ['Provider', 'Models Available'],
  [
    ['Anthropic', 'Claude Opus, Sonnet, Haiku'],
    ['OpenAI', 'GPT-4o, GPT-4o mini, o1'],
    ['Google', 'Gemini 1.5 Pro, Flash'],
    ['Groq', 'Llama 3.1 (ultra-fast inference)'],
    ['OpenRouter', 'Every model via one API key'],
    ['Mistral', 'Mistral Large, Medium'],
  ],
  [150, 330]
);

h2('Hybrid Mode');
body('Use a fast local model for quick tasks. Route complex reasoning to an API model. JARVIS decides automatically based on task complexity, or the user sets rules manually.');

// ── FULL FEATURE SET ──────────────────────────────────────────────────────────
sectionHeader('4. COMPLETE FEATURE SET');

h2('Core');
bullet('Floating cursor-following bubble — works over every app');
bullet('Expand to full sidebar (420px wide, full screen height)');
bullet('Watch Me Work recording and playbook generation');
bullet('Persistent memory — remembers everything, forever');
bullet('Natural language task execution ("send the invoice to John")');
bullet('Multi-agent routing — right agent for right task');
bullet('Self-improving — learns from every interaction');
bullet('Works fully offline in local model mode');

h2('Five Built-In Agents');
table(
  ['Agent', 'Speciality', 'Routes When...'],
  [
    ['JARVIS Core', 'General assistant, task routing', 'Default — all general requests'],
    ['KAREN', 'Email, calendar, scheduling', 'Anything about meetings, emails, time'],
    ['CODER', 'Code, debugging, technical', 'Any code or technical question'],
    ['HERMIONE', 'Research, documents, knowledge', '"Find", "research", "summarise"'],
    ['HARRY', 'Files, execution, system tasks', '"Create", "move", "run", "open"'],
  ],
  [90, 160, 230]
);

h2('Connectors — One-Click Install, No Terminal');
body('All connectors install from Settings → Connectors panel.');
const connectors = [
  ['Communication', 'Gmail, Outlook, Slack, Discord, Microsoft Teams'],
  ['Productivity', 'Notion, Google Docs, Google Sheets, Google Calendar, Todoist, Linear'],
  ['Files', 'Google Drive, Dropbox, OneDrive, Local filesystem'],
  ['Development', 'GitHub, VS Code, Cursor, Browser automation'],
  ['Business', 'HubSpot, Stripe, Airtable'],
];
connectors.forEach(([cat, items]) => {
  h3(cat);
  bullet(items);
});

h2('Skills Store');
bullet('Browse skills by category');
bullet('One-click install');
bullet('Import skill bundle by pasting a GitHub link');
bullet('Skills run from chat: type /skill-name or click from store');
bullet('Build your own skills — no code, template editor');
bullet('Community skills marketplace (V2)');

h2('Settings Panel');
bullet('Model selector — switch between local and API any time');
bullet('API key manager — encrypted local storage');
bullet('Connector manager');
bullet('Shortcut customiser');
bullet('Memory settings — auto-save on/off, retention period');
bullet('Recording settings — frame rate, audio on/off');
bullet('Theme — dark / light / system');
bullet('Startup behaviour — launch on login, start minimised');

// ── TECHNICAL ARCHITECTURE ────────────────────────────────────────────────────
sectionHeader('5. TECHNICAL ARCHITECTURE');
table(
  ['Layer', 'Technology', 'Role'],
  [
    ['Agent orchestration', 'OpenClaw', 'Multi-model, multi-platform, MIT licensed'],
    ['Workflow engine', 'LangGraph / CrewAI', 'Chains agents into pipelines, parallel execution'],
    ['Persistent memory', 'Hermes Agent + SQLite', 'Local memory that survives sessions'],
    ['Local LLM', 'Llama 3.1 via Ollama', 'Zero API costs, offline, fully private'],
    ['Tool automation', 'Activepieces (MIT)', 'Connects to 200+ external services'],
    ['Backend API', 'FastAPI / Express', 'REST interface between frontend and backend'],
    ['Frontend overlay', 'Electron 42 + React 19', 'The floating UI — already started'],
  ],
  [130, 140, 210]
);

// ── COMPLETE API ──────────────────────────────────────────────────────────────
sectionHeader('6. COMPLETE API — EVERY ENDPOINT');

h2('Health');
codeBlock([
  'GET  /api/health',
  '  → { status, model, modelType, memoryCount, uptime }',
]);

h2('Models');
codeBlock([
  'GET  /api/models/available',
  '  → { local: [{ id, name, size, installed }], api: [{ id, name, provider }] }',
  '',
  'POST /api/models/install    body: { modelId }',
  '  → { success, progress }',
  '',
  'POST /api/models/set        body: { modelId, type, apiKey? }',
  '  → { success, active }',
  '',
  'POST /api/models/test       body: { modelId }',
  '  → { latencyMs, response, status }',
]);

h2('Chat');
codeBlock([
  'POST /api/chat              body: { agentId, message, sessionId?, attachments? }',
  '  → { response, agentUsed, memoryUsed, tokens }',
  '',
  'GET  /api/chat/history      query: { sessionId, limit }',
  '  → { messages: [{ role, content, timestamp, agent }] }',
  '',
  'DELETE /api/chat/session    body: { sessionId }',
]);

h2('Recording + Playbook');
codeBlock([
  'POST /api/record/start      body: { captureAudio?: boolean }',
  '  → { sessionId, startedAt }',
  '',
  'POST /api/record/stop       body: { sessionId }',
  '  → { sessionId, duration, frameCount, actionCount }',
  '',
  'POST /api/playbook/generate body: { sessionId, title? }',
  '  → { playbookId, title, steps: [{ order, description, screenshot, automatable }] }',
  '',
  'GET  /api/playbook/list     → { playbooks: [{ id, title, steps, createdAt }] }',
  '',
  'POST /api/playbook/run      body: { playbookId, speed? }',
  '  → { success, stepsCompleted, errors? }',
  '',
  'POST /api/playbook/export   body: { playbookId, format: "pdf"|"json"|"video" }',
  '  → { downloadUrl }',
]);

h2('Memory');
codeBlock([
  'GET  /api/memory/search     query: { q, limit }',
  '  → { memories: [{ content, timestamp, relevance }] }',
  '',
  'POST /api/memory/save       body: { content, tags? }',
  '  → { id, success }',
  '',
  'DELETE /api/memory/:id',
  'GET  /api/memory/export     → JSON download',
  'POST /api/memory/clear      → { success, cleared }',
]);

h2('Skills');
codeBlock([
  'GET  /api/skills',
  'POST /api/skills/install         body: { source: "github-url"|"registry-id" }',
  'POST /api/skills/install-bundle  body: { manifestUrl }',
  '  → { success, installed: [], failed: [] }',
  'POST /api/skills/run             body: { skillId, params: {} }',
  'DELETE /api/skills/:id',
]);

h2('Connectors');
codeBlock([
  'GET  /api/connectors',
  'POST /api/connectors/install     body: { connectorId }',
  'POST /api/connectors/auth        body: { connectorId, credentials }',
  'POST /api/connectors/execute     body: { connectorId, action, params }',
  'DELETE /api/connectors/:id',
]);

// ── BUILD ORDER ───────────────────────────────────────────────────────────────
sectionHeader('7. BUILD ORDER — STEP BY STEP');

const steps = [
  ['Step 1 — Week 1', 'Get a Response', 'Install Ollama. Pull llama3.1. Build /api/chat. Connect chat UI. Type a message, get a reply.'],
  ['Step 2 — Week 1', 'Add API Models', 'Build model selector in Settings. User switches between Llama and Claude. Store API key encrypted locally.'],
  ['Step 3 — Week 2', 'Add Memory', 'Set up SQLite. Save every message. Search past context on each new message. Inject into AI prompt automatically.'],
  ['Step 4 — Week 3', 'Watch Me Work', 'Record button → screenshot loop → action log → Stop → AI generates playbook → display in sidebar.'],
  ['Step 5 — Week 4', 'Connectors', 'Gmail OAuth (browser-based, no terminal). Notion. Calendar. Test: "Create a Notion page" → it appears.'],
  ['Step 6 — Week 5', 'Run Playbooks', 'Each playbook step calls /api/connectors/execute. Progress bar in UI. Non-automatable steps prompt user.'],
  ['Step 7 — Week 6', 'Skills System', 'Skills are JSON files. Install from GitHub URL. Store in ~/.jarvis/skills/. Trigger from chat via /skill-name.'],
  ['Step 8 — Week 7-8', 'Polish', 'Loading states. Human error messages. Onboarding flow. Auto-updater. Local crash reporting.'],
];
steps.forEach(([phase, title, desc]) => {
  h3(`${phase} — ${title}`);
  body(desc);
});

// ── DATABASE SCHEMA ────────────────────────────────────────────────────────────
sectionHeader('8. DATABASE SCHEMA');
codeBlock([
  'CREATE TABLE messages (',
  '  id TEXT PRIMARY KEY, session_id TEXT, role TEXT,',
  '  content TEXT, agent TEXT, timestamp INTEGER, tokens INTEGER',
  ');',
  '',
  'CREATE TABLE memories (',
  '  id TEXT PRIMARY KEY, content TEXT, embedding BLOB,',
  '  tags TEXT, source TEXT, created_at INTEGER',
  ');',
  '',
  'CREATE TABLE playbooks (',
  '  id TEXT PRIMARY KEY, title TEXT, description TEXT,',
  '  steps TEXT, recording_id TEXT, created_at INTEGER,',
  '  last_run INTEGER, run_count INTEGER',
  ');',
  '',
  'CREATE TABLE skills (',
  '  id TEXT PRIMARY KEY, name TEXT, trigger TEXT,',
  '  prompt_template TEXT, source_url TEXT, installed_at INTEGER',
  ');',
  '',
  'CREATE TABLE connectors (',
  '  id TEXT PRIMARY KEY, name TEXT, status TEXT,',
  '  credentials TEXT, last_used INTEGER',
  ');',
]);

// ── SKILLS BUNDLE ─────────────────────────────────────────────────────────────
sectionHeader('9. SKILLS BUNDLE — MANIFEST FORMAT');
body('Host this file on GitHub. Users paste the URL into JARVIS Skills Store → Import Bundle. Everything installs automatically — no terminal.');
codeBlock([
  '{',
  '  "name": "JARVIS Official Skills Bundle",',
  '  "version": "1.0.0",',
  '  "skills": [',
  '    {',
  '      "id": "deep-research",',
  '      "trigger": "/research",',
  '      "description": "Multi-source research on any topic",',
  '      "prompt": "Research: {{topic}}. Multiple sources, key facts, summary.",',
  '      "category": "research"',
  '    },',
  '    { "id": "email-writer", "trigger": "/email", ... }',
  '  ]',
  '}',
]);

body('Manifest URL to share with users:');
codeBlock(['https://raw.githubusercontent.com/jarvis-ai/skills/main/bundle.json']);

// ── SKILLS LIST ───────────────────────────────────────────────────────────────
sectionHeader('10. COMPLETE SKILLS LIST');

const skillCategories = [
  {
    name: 'Research & Knowledge',
    skills: [
      ['/research', 'Multi-source research, structured summary'],
      ['/fact-check', 'Verify claims against multiple sources'],
      ['/summarise', 'Condense any document or text'],
      ['/compare', 'Compare two things side by side'],
      ['/explain', 'Explain anything in simple terms'],
      ['/competitor', 'Research a competitor deeply'],
      ['/market', 'Research a market or industry'],
    ],
  },
  {
    name: 'Writing & Content',
    skills: [
      ['/email', 'Write any professional email'],
      ['/email-sequence', 'Write a 5-email nurture sequence'],
      ['/blog', 'Write a full SEO blog post'],
      ['/landing', 'Write conversion-focused landing page copy'],
      ['/linkedin', 'Write engaging LinkedIn content'],
      ['/thread', 'Write a viral Twitter/X thread'],
      ['/newsletter', 'Write a full newsletter edition'],
      ['/proposal', 'Write a business proposal'],
      ['/press', 'Write a press release'],
    ],
  },
  {
    name: 'Business & Strategy',
    skills: [
      ['/bizplan', 'Generate a structured business plan'],
      ['/swot', 'SWOT analysis for any business or idea'],
      ['/pricing', 'Develop a pricing strategy'],
      ['/icp', 'Define your ideal customer profile'],
      ['/growth', 'Build a growth plan'],
      ['/launch', 'Plan a product or campaign launch'],
      ['/okr', 'Generate quarterly OKRs'],
      ['/decide', 'Structured decision-making framework'],
    ],
  },
  {
    name: 'Development & Technical',
    skills: [
      ['/review', 'Review any code for quality and bugs'],
      ['/debug', 'Debug an error or broken code'],
      ['/refactor', 'Rewrite messy code cleanly'],
      ['/api', 'Design a REST API'],
      ['/schema', 'Design a database schema'],
      ['/security', 'Audit code for vulnerabilities'],
      ['/tests', 'Write unit tests for any code'],
      ['/docs', 'Write technical documentation'],
      ['/arch', 'Design system architecture'],
    ],
  },
  {
    name: 'Productivity & Operations',
    skills: [
      ['/breakdown', 'Break a project into tasks'],
      ['/prioritise', 'Sort tasks by impact and effort'],
      ['/weekly', 'Structure a weekly review'],
      ['/sop', 'Write a standard operating procedure'],
      ['/checklist', 'Generate a comprehensive checklist'],
      ['/retro', 'Run a sprint retrospective'],
      ['/risk', 'Identify and rate project risks'],
    ],
  },
  {
    name: 'Sales & Marketing',
    skills: [
      ['/cold', 'Write personalised cold outreach'],
      ['/script', 'Write a sales call script'],
      ['/objection', 'Handle specific sales objections'],
      ['/casestudy', 'Write a customer case study'],
      ['/ad', 'Write Facebook and Google ad copy'],
      ['/seo', 'Create an SEO content brief'],
      ['/leadmagnet', 'Design a lead magnet'],
    ],
  },
  {
    name: 'Personal & Learning',
    skills: [
      ['/study', 'Create a learning roadmap'],
      ['/flashcards', 'Generate study flashcards'],
      ['/eli5', 'Explain like I am 5'],
      ['/brainstorm', 'Generate 20 ideas for anything'],
      ['/critique', 'Honest critical analysis'],
      ['/mentor', 'Get advice as a strict mentor'],
    ],
  },
];

skillCategories.forEach(({ name, skills }) => {
  h2(name);
  table(['Trigger', 'What It Does'], skills, [100, 380]);
});

// ── APEX COMPARISON ────────────────────────────────────────────────────────────
sectionHeader('11. WHY JARVIS BEATS APEX');
table(
  ['Feature', 'APEX', 'JARVIS'],
  [
    ['Model choice', 'Locked to one', 'Local + any API'],
    ['Works offline', 'No', 'Yes'],
    ['Watch Me Work', 'No', 'Yes — core feature'],
    ['No terminal ever', 'No', 'Yes'],
    ['Skills store with GUI', 'No', 'Yes'],
    ['Import skills by link', 'No', 'Yes'],
    ['Connectors one-click', 'No', 'Yes'],
    ['MCP open standard', 'No', 'Yes — community can build'],
    ['Permanent memory', 'No', 'Yes'],
    ['Your hardware', 'No', 'Yes — fully private'],
    ['Pricing', 'Monthly subscription', 'One-time setup + optional support'],
  ],
  [180, 130, 170]
);

// ── BUSINESS MODEL ─────────────────────────────────────────────────────────────
sectionHeader('12. BUSINESS MODEL');
table(
  ['Revenue Stream', 'Amount', 'Notes'],
  [
    ['One-time setup fee', '£750', 'Per customer install and configuration'],
    ['Monthly support', '£149/month', 'Optional — updates, help, improvements'],
    ['Training session', '£350', 'Optional — deep walkthrough for team'],
  ],
  [160, 110, 210]
);
doc.moveDown(0.3);
h2('Year 1 Targets');
table(
  ['Milestone', 'Target', 'Revenue'],
  [
    ['Month 4', 'First paying customer', '£750 + £149/mo'],
    ['Month 6', '3 customers', '£2,250 + £447/mo'],
    ['Month 12', '10 customers', '£7,500 + £1,490/mo'],
  ],
  [100, 160, 220]
);

// ── TIMELINE ───────────────────────────────────────────────────────────────────
sectionHeader('13. TIMELINE');
table(
  ['Phase', 'Target', 'Milestone'],
  [
    ['Now', 'Week 1', 'Co-founder agreement signed. Ollama running. First message works.'],
    ['Month 1', 'End of month', 'Chat + memory + two API models working.'],
    ['Month 2', 'End of month', 'Recording feature + playbook generation. Gmail + Notion connected.'],
    ['Month 3', 'End of month', 'Skills store. All 5 agents routing. Full API complete.'],
    ['Month 4', 'End of month', 'First alpha user. Real feedback collected.'],
    ['Month 6', 'End of month', 'First paying customer. £750 received.'],
    ['Month 12', 'End of year', '10 customers. Recurring revenue flowing. V2 planning begins.'],
  ],
  [80, 100, 300]
);

// ── FIRST STEP ─────────────────────────────────────────────────────────────────
sectionHeader('14. THIS WEEK — FIRST THREE TASKS');
h2('Task 1 — Get a Response (Together)');
body('Install Ollama. Pull llama3.1. Build /api/health and /api/chat. Connect the chat UI to it. Get one message to work end to end. Test: type "hello" in JARVIS chat → get a reply from local Llama.');
h2('Task 2 — Add API Models (Together)');
body('Add model selector to Settings. User can switch between Llama and Claude Haiku. Store the selected model and API key in encrypted local config. Test: switch models, same message, different response.');
h2('Task 3 — Add Memory (Together)');
body('Set up SQLite. Save every message with role, content, timestamp. On each new message, search memory for relevant past context and inject it into the AI prompt. Test: tell JARVIS your name → new chat → ask "what is my name?" → it knows.');

doc.moveDown(1);
doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#0f172a');
doc.fillColor(CYAN).fontSize(12).font('Helvetica-Bold')
   .text('After these three tasks, JARVIS is alive.', 58, doc.y - 48, { width: doc.page.width - 116 });
doc.fillColor(MUTED).fontSize(10).font('Helvetica')
   .text('Everything else is features on top of a working foundation.', 58, doc.y - 26, { width: doc.page.width - 116 });

// ── FOOTERS ───────────────────────────────────────────────────────────────────
doc.end();
doc.on('end', () => {});

pageFooter();

console.log('PDF saved to:', outputPath);
