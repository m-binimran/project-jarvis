/**
 * Advisor Content Scraper — Decision 12
 *
 * Uses the Browser MCP (Playwright) to fetch real public content
 * from each advisor's known sources. Stores in advisor_knowledge.
 *
 * Sources per built-in advisor:
 *   Naval:   nav.al, twitter/x threads, podcast transcripts
 *   Hormozi: acquisition.com/blog, youtube video descriptions
 *   PG:      paulgraham.com/articles
 *
 * Legal: scraping publicly available content is standard practice.
 * Content stays local — never shared, never sent to us.
 */

import type { MCPRouter } from "../mcp/router.ts";
import type { LLMManager } from "../llm/manager.ts";
import { addAdvisorKnowledge, listAdvisors } from "./advisor-council.ts";
import { getDb, now } from "../vault/schema.ts";

interface ScrapeSources {
  [advisorId: string]: Array<{ url: string; description: string }>;
}

const ADVISOR_SOURCES: ScrapeSources = {
  naval: [
    { url: "https://nav.al", description: "Naval's blog and essays" },
    { url: "https://nav.al/almanack", description: "Almanack of Naval Ravikant" },
  ],
  hormozi: [
    { url: "https://www.acquisition.com/blog", description: "Alex Hormozi blog" },
    { url: "https://www.acquisition.com/training", description: "Hormozi training content" },
  ],
  pg: [
    { url: "http://paulgraham.com/articles.html", description: "Paul Graham essays index" },
    { url: "http://paulgraham.com/startupideas.html", description: "How to Get Startup Ideas" },
    { url: "http://paulgraham.com/ds.html", description: "Do Things that Don't Scale" },
  ],
};

export async function scrapeAdvisorContent(
  advisorId: string,
  router: MCPRouter,
  llm: LLMManager
): Promise<{ scraped: number; errors: string[] }> {
  const sources = ADVISOR_SOURCES[advisorId];
  if (!sources) return { scraped: 0, errors: [`No sources configured for advisor: ${advisorId}`] };

  let scraped = 0;
  const errors: string[] = [];

  for (const source of sources) {
    try {
      // Navigate to the page
      await router.call("browser_navigate", { url: source.url });
      await router.call("browser_wait", { ms: 2000 });

      // Extract the text content
      const result = await router.call("browser_extract", {}) as { text?: string; error?: string };
      if (result.error || !result.text) {
        errors.push(`${source.url}: ${result.error ?? "no content"}`);
        continue;
      }

      const rawText = result.text.slice(0, 6000); // cap at 6k chars per page

      // Use LLM to extract key insights from the raw page text
      const summary = await llm.complete([
        {
          role: "system",
          content: `You extract the key insights, principles, and frameworks from ${advisorId}'s content.
Extract 3-5 key ideas as separate paragraphs. Focus on actionable frameworks, quotes, and core principles.
Only include what's actually in the text — do not add your own ideas.`,
        },
        { role: "user", content: `Extract key insights from this content:\n\n${rawText}` },
      ], { agentId: "advisor-scraper" });

      // Store in advisor_knowledge
      addAdvisorKnowledge(advisorId, summary.content, "scraped", source.url);
      scraped++;

      console.log(`[scraper] ${advisorId}: scraped ${source.url}`);

      // Update last_synced on the advisor record
      const db = getDb();
      db.run(`UPDATE advisors SET last_synced=? WHERE id=?`, [now(), advisorId]);

    } catch (e) {
      errors.push(`${source.url}: ${String(e)}`);
      console.warn(`[scraper] Failed to scrape ${source.url}:`, e);
    }
  }

  return { scraped, errors };
}

/** Scrape all built-in advisors that haven't been synced in the last 7 days */
export async function scrapeStaleAdvisors(router: MCPRouter, llm: LLMManager): Promise<void> {
  const advisors = listAdvisors();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const advisor of advisors) {
    const isStale = !advisor.lastSynced || advisor.lastSynced < sevenDaysAgo;
    if (isStale && ADVISOR_SOURCES[advisor.id]) {
      console.log(`[scraper] Starting scrape for ${advisor.name}...`);
      await scrapeAdvisorContent(advisor.id, router, llm);
    }
  }
}
