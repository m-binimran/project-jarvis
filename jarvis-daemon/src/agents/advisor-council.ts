/**
 * JARVIS Advisor Council
 *
 * User picks mentors. JARVIS responds in their voice/frameworks.
 *
 * Architecture:
 *   1. User adds an advisor (name + focus + optional source URLs)
 *   2. For each source URL, fetch text content and store in advisor_knowledge (FTS)
 *   3. When a question is asked "as" an advisor, retrieve top K relevant chunks
 *      and build a system prompt that embodies that advisor's voice + philosophy
 *   4. LLM responds AS the advisor, grounded in their actual content
 *
 * Why FTS instead of vector embeddings?
 *   - No additional models needed (sqlite fts5 is built-in)
 *   - Fast, zero cost, fully local
 *   - Works well for knowledge retrieval on small-to-medium corpora
 *   - V2 will add real embeddings via Ollama
 *
 * Pre-loaded advisors (user can add more):
 *   - Naval Ravikant (wealth, startups, philosophy)
 *   - Alex Hormozi (offers, sales, business growth)
 *   - Paul Graham (startups, essays, founders)
 */

import { getDb, generateId, now } from "../vault/schema.ts";
import type { AgentDefinition } from "./runner.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Advisor {
  id: string;
  name: string;
  focus: string;
  sources: string[];      // URLs to fetch content from
  lastSynced?: number;
  createdAt: number;
}

export interface AdvisorKnowledge {
  id: string;
  advisorId: string;
  content: string;
  sourceType: "scraped" | "manual" | "summary";
  sourceUrl?: string;
  createdAt: number;
}

// ── Pre-loaded advisor profiles ───────────────────────────────────────────────

export const BUILT_IN_ADVISORS: Omit<Advisor, "createdAt" | "lastSynced">[] = [
  {
    id: "naval",
    name: "Naval Ravikant",
    focus: "Wealth creation, startups, philosophy, reading, health, happiness",
    sources: [],
  },
  {
    id: "hormozi",
    name: "Alex Hormozi",
    focus: "Offer creation, sales, business scaling, $100M growth playbooks",
    sources: [],
  },
  {
    id: "pg",
    name: "Paul Graham",
    focus: "Startups, founder psychology, product, essays, YC wisdom",
    sources: [],
  },
];

// Built-in knowledge seeds — high-signal public content (no scraping needed)
const BUILT_IN_KNOWLEDGE: Array<{ advisorId: string; content: string }> = [
  // Naval
  {
    advisorId: "naval",
    content: `Specific knowledge: You will not get rich renting out your time. You must own equity — a piece of a business — to gain your financial freedom. Seek wealth, not money or status. Wealth is having assets that earn while you sleep. Money is how we transfer time and wealth. Status is your rank in the social hierarchy.`,
  },
  {
    advisorId: "naval",
    content: `Judgment over effort: Leverage is everything. Code, media, and capital are the new leverage — they have near-zero marginal cost of replication. A leveraged worker can out-produce a non-leveraged worker by 1000x. The most powerful form of leverage is the product business — one employee creates something that is sold to millions.`,
  },
  {
    advisorId: "naval",
    content: `On learning: Read what you love until you love to read. The foundations of rational thought are mathematics, basic logic, and statistics. To be wealthy, you need to be free. To be free, you need to own your time. To own your time, you need assets. All returns in life — whether in wealth, relationships, or knowledge — come from compound interest.`,
  },
  {
    advisorId: "naval",
    content: `On decisions: The most important skill for getting rich is becoming the best in the world at something. Apply specific knowledge, leverage, and eventually you will get what you deserve. Productize yourself: what unique knowledge do you have, and how can you apply it with leverage? Ignore status games — they consume your time and energy for zero return on wealth.`,
  },
  // Hormozi
  {
    advisorId: "hormozi",
    content: `The Grand Slam Offer: The goal of an offer is to make it so good that people feel stupid saying no. Stack value until the price seems trivial. The dream outcome minus the time delay minus the effort minus the sacrifice plus likelihood of achievement equals value. People don't pay for products — they pay for outcomes.`,
  },
  {
    advisorId: "hormozi",
    content: `On sales and pricing: Raise your prices. High prices signal high value. The biggest mistake is competing on price — you'll race to the bottom and kill your margin. Instead, change the who. Find people who can easily afford you and for whom the problem is painful. A $10K client is not 10x harder to get than a $1K client.`,
  },
  {
    advisorId: "hormozi",
    content: `On volume: Most businesses fail not from bad products but from insufficient leads. The business that can spend the most money acquiring a customer wins. If you can acquire a customer for less than they're worth to you, you have a money machine. Fix your funnel before fixing your product. Speed of implementation separates winners from losers.`,
  },
  {
    advisorId: "hormozi",
    content: `On retention and scaling: Making money is easy. Keeping it is hard. Most entrepreneurs get rich then stay broke because they upgrade lifestyle instead of reinvesting. To scale, you need: a consistent acquisition system, a product that delivers the promised outcome, and an operational system that doesn't require you. Hire for your weaknesses early.`,
  },
  // Paul Graham
  {
    advisorId: "pg",
    content: `On startups: Make something people want. That's it. Everything else is secondary. The best startup ideas come from noticing a problem you yourself have. If you're solving your own problem, you know it's real. Start with a small market you can dominate, not a large market you can barely address. Airbnb started with air mattresses in San Francisco apartments.`,
  },
  {
    advisorId: "pg",
    content: `On growth and focus: Do things that don't scale first. Manually acquire users. Personally onboard customers. Use this phase to understand your users deeply — you can't get that from analytics. The job of a startup is to grow. Everything else is in service of that. Growth solves almost all problems. No growth reveals all problems.`,
  },
  {
    advisorId: "pg",
    content: `On founders: What makes a good startup founder? Determination, flexibility, imagination, naughtiness, and friendship. Determination above all — startups are a long slog. You need the resilience to keep going when it looks hopeless, because it almost always looks hopeless for a while before it works. The most important question is: are you making something people want?`,
  },
  {
    advisorId: "pg",
    content: `On essays and thinking: Writing is thinking. When you write clearly, you think clearly. Clarity of thought produces clarity of prose, and vice versa. The essays that matter most are the ones that say things people know but haven't articulated. If what you're writing surprises you, it's probably worth writing. The goal is to discover, not to display knowledge.`,
  },
];

// ── Database operations ───────────────────────────────────────────────────────

export function initAdvisorCouncil(): void {
  const db = getDb();

  // Seed built-in advisors if they don't exist
  for (const advisor of BUILT_IN_ADVISORS) {
    const exists = db.query<{ id: string }>(
      "SELECT id FROM advisors WHERE id = ?"
    ).get(advisor.id);

    if (!exists) {
      db.run(
        `INSERT INTO advisors(id,name,focus,sources,created_at)
         VALUES(?,?,?,?,?)`,
        [advisor.id, advisor.name, advisor.focus, JSON.stringify(advisor.sources), now()]
      );
    }
  }

  // Seed built-in knowledge if advisor_knowledge table is empty for each advisor
  for (const knowledge of BUILT_IN_KNOWLEDGE) {
    const exists = db.query<{ id: string }>(
      `SELECT id FROM advisor_knowledge
       WHERE advisor_id = ? AND source_type = 'summary'
       LIMIT 1`
    ).get(knowledge.advisorId);

    if (!exists) {
      db.run(
        `INSERT INTO advisor_knowledge(id,advisor_id,content,source_type,created_at)
         VALUES(?,?,?,?,?)`,
        [generateId(), knowledge.advisorId, knowledge.content, "summary", now()]
      );
    }
  }
}

export function listAdvisors(): Advisor[] {
  const db = getDb();
  const rows = db.query<{
    id: string;
    name: string;
    focus: string;
    sources: string;
    last_synced: number | null;
    created_at: number;
  }>("SELECT * FROM advisors ORDER BY name").all();

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    focus: r.focus,
    sources: JSON.parse(r.sources || "[]"),
    lastSynced: r.last_synced ?? undefined,
    createdAt: r.created_at,
  }));
}

export function addAdvisor(advisor: {
  name: string;
  focus: string;
  sources?: string[];
}): Advisor {
  const db = getDb();
  const id = generateId();
  const ts = now();

  db.run(
    `INSERT INTO advisors(id,name,focus,sources,created_at) VALUES(?,?,?,?,?)`,
    [id, advisor.name, advisor.focus, JSON.stringify(advisor.sources ?? []), ts]
  );

  return { id, name: advisor.name, focus: advisor.focus, sources: advisor.sources ?? [], createdAt: ts };
}

export function addAdvisorKnowledge(
  advisorId: string,
  content: string,
  sourceType: "scraped" | "manual" | "summary",
  sourceUrl?: string
): void {
  const db = getDb();
  db.run(
    `INSERT INTO advisor_knowledge(id,advisor_id,content,source_type,source_url,created_at)
     VALUES(?,?,?,?,?,?)`,
    [generateId(), advisorId, content, sourceType, sourceUrl ?? null, now()]
  );
}

/** Retrieve top K knowledge chunks for an advisor using FTS */
export function searchAdvisorKnowledge(
  advisorId: string,
  query: string,
  topK = 4
): string[] {
  const db = getDb();

  // Try FTS search first
  try {
    const results = db.query<{ content: string }>(
      `SELECT ak.content
       FROM advisor_knowledge_fts fts
       JOIN advisor_knowledge ak ON ak.rowid = fts.rowid
       WHERE fts.content MATCH ? AND ak.advisor_id = ?
       ORDER BY rank
       LIMIT ?`
    ).all(query, advisorId, topK);

    if (results.length > 0) return results.map(r => r.content);
  } catch { /* FTS not available — fall back */ }

  // Fallback: recent knowledge chunks
  const fallback = db.query<{ content: string }>(
    `SELECT content FROM advisor_knowledge
     WHERE advisor_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(advisorId, topK);

  return fallback.map(r => r.content);
}

// ── Agent factory ─────────────────────────────────────────────────────────────

/**
 * Build a dynamic advisor agent for a given advisor.
 * The system prompt is constructed from their bio + retrieved knowledge.
 */
export function buildAdvisorAgent(
  advisor: Advisor,
  query: string
): AgentDefinition {
  const knowledge = searchAdvisorKnowledge(advisor.id, query);

  const knowledgeSection = knowledge.length > 0
    ? `\n\nYour knowledge and philosophy (from your own writing and thinking):\n${knowledge.map((k, i) => `${i + 1}. ${k}`).join("\n\n")}`
    : "";

  return {
    id: `advisor-${advisor.id}`,
    name: advisor.name,
    role: "specialist",
    systemPrompt: `You are ${advisor.name}, responding as a council advisor to JARVIS's user.

Your focus areas: ${advisor.focus}
${knowledgeSection}

IMPORTANT RULES:
- Respond in the first person, in ${advisor.name}'s voice, philosophy, and communication style
- Ground your advice in the actual knowledge above — don't invent positions they've never held
- Be direct and concrete. Cut the fluff. Give specific, actionable advice
- If the question is outside your expertise, say so and point them to who would know better
- Do not pretend to be an AI or JARVIS. You are ${advisor.name}

Start your response naturally — no preamble, no "As ${advisor.name}..." — just respond.`,
    tools: [],  // Advisors only speak — no tool use
    maxTurns: 1,
    temperature: 0.7,
  };
}
