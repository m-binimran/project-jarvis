/**
 * JARVIS Browser MCP Connector
 *
 * Gives every agent full browser control via Playwright.
 * One connector replaces 20 per-service MCPs.
 *
 * Tools:
 *   browser_navigate   — go to a URL
 *   browser_click      — click an element by CSS selector or text
 *   browser_type       — type text into an input
 *   browser_extract    — extract text/data from the page
 *   browser_screenshot — take a screenshot (returns base64)
 *   browser_wait       — wait for an element to appear
 *   browser_scroll     — scroll the page
 *   browser_evaluate   — run JavaScript on the page
 *   browser_close      — close the current page
 *
 * The browser runs headlessly by default. Set JARVIS_BROWSER_HEADLESS=false
 * to watch JARVIS work in a visible window.
 *
 * Decision: Playwright replaces per-service MCPs for universal browser control.
 */

import type { MCPRouter } from "../router.ts";

// ── Lazy browser management ───────────────────────────────────────────────────
// We keep one browser instance alive and reuse pages across calls.
// The browser starts on the first browser_navigate call.

let browserInstance: import("playwright").Browser | null = null;
let activePage:      import("playwright").Page | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    const { chromium } = await import("playwright");
    const headless = process.env.JARVIS_BROWSER_HEADLESS !== "false";
    browserInstance = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    console.log(`[browser] Chromium launched (headless=${headless})`);
  }
  return browserInstance;
}

async function getPage(): Promise<import("playwright").Page> {
  const browser = await getBrowser();
  if (!activePage || activePage.isClosed()) {
    activePage = await browser.newPage();
    activePage.setDefaultTimeout(15000);
    // Stealth: override navigator properties to reduce bot detection
    await activePage.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
  }
  return activePage;
}

export async function closeBrowser(): Promise<void> {
  if (activePage && !activePage.isClosed()) await activePage.close();
  if (browserInstance?.isConnected()) await browserInstance.close();
  activePage = null;
  browserInstance = null;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function navigate(params: Record<string, unknown>) {
  const url = String(params.url ?? "");
  if (!url) return { error: "url is required" };
  const page = await getPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  const title = await page.title();
  return { success: true, url: page.url(), title };
}

async function click(params: Record<string, unknown>) {
  const selector = String(params.selector ?? "");
  const text     = String(params.text ?? "");
  const page     = await getPage();
  try {
    if (text) {
      await page.getByText(text, { exact: false }).first().click({ timeout: 8000 });
    } else {
      await page.click(selector, { timeout: 8000 });
    }
    return { success: true };
  } catch (e) {
    return { error: String(e) };
  }
}

async function type(params: Record<string, unknown>) {
  const selector = String(params.selector ?? "");
  const text     = String(params.text ?? "");
  const page     = await getPage();
  try {
    await page.fill(selector, text);
    return { success: true };
  } catch (e) {
    return { error: String(e) };
  }
}

async function extract(params: Record<string, unknown>) {
  const selector = params.selector ? String(params.selector) : null;
  const page     = await getPage();
  try {
    if (selector) {
      const elements = await page.$$eval(selector, els =>
        els.map(el => ({ text: el.textContent?.trim(), href: (el as HTMLAnchorElement).href ?? null }))
      );
      return { success: true, data: elements };
    } else {
      // Full page text
      const text = await page.evaluate(() => document.body.innerText);
      return { success: true, text: text.slice(0, 8000) }; // cap at 8k chars
    }
  } catch (e) {
    return { error: String(e) };
  }
}

async function screenshot(params: Record<string, unknown>) {
  const page = await getPage();
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 70 });
    return { success: true, dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` };
  } catch (e) {
    return { error: String(e) };
  }
}

async function wait(params: Record<string, unknown>) {
  const selector = String(params.selector ?? "");
  const ms       = Number(params.ms ?? 2000);
  const page     = await getPage();
  try {
    if (selector) {
      await page.waitForSelector(selector, { timeout: 15000 });
      return { success: true };
    } else {
      await page.waitForTimeout(Math.min(ms, 10000));
      return { success: true };
    }
  } catch (e) {
    return { error: String(e) };
  }
}

async function scroll(params: Record<string, unknown>) {
  const direction = String(params.direction ?? "down");
  const amount    = Number(params.amount ?? 500);
  const page      = await getPage();
  await page.evaluate(({ direction, amount }) => {
    window.scrollBy(0, direction === "down" ? amount : -amount);
  }, { direction, amount });
  return { success: true };
}

async function evaluate(params: Record<string, unknown>) {
  const code = String(params.code ?? "");
  const page = await getPage();
  try {
    const result = await page.evaluate(code);
    return { success: true, result };
  } catch (e) {
    return { error: String(e) };
  }
}

async function closeTab(_params: Record<string, unknown>) {
  if (activePage && !activePage.isClosed()) {
    await activePage.close();
    activePage = null;
  }
  return { success: true };
}

// ── Register with MCP router ──────────────────────────────────────────────────

export function registerBrowser(router: MCPRouter): void {
  const connector = {
    id: "browser",
    name: "Browser",
    description: "Full browser control via Playwright. Navigate, click, type, extract data from any website.",
    tools: [
      {
        name: "browser_navigate",
        description: "Open a URL in the browser. Use this to visit any website.",
        category: "read_file" as const,
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        handler: navigate,
      },
      {
        name: "browser_click",
        description: "Click an element. Provide CSS selector OR visible text of the button/link.",
        category: "write_file" as const,
        inputSchema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } },
        handler: click,
      },
      {
        name: "browser_type",
        description: "Type text into an input field identified by CSS selector.",
        category: "write_file" as const,
        inputSchema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] },
        handler: type,
      },
      {
        name: "browser_extract",
        description: "Extract text/data from the page. Omit selector to get full page text.",
        category: "read_file" as const,
        inputSchema: { type: "object", properties: { selector: { type: "string" } } },
        handler: extract,
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current browser page.",
        category: "read_file" as const,
        inputSchema: { type: "object", properties: {} },
        handler: screenshot,
      },
      {
        name: "browser_wait",
        description: "Wait for a CSS selector to appear, or wait ms milliseconds.",
        category: "read_file" as const,
        inputSchema: { type: "object", properties: { selector: { type: "string" }, ms: { type: "number" } } },
        handler: wait,
      },
      {
        name: "browser_scroll",
        description: "Scroll the page up or down by a number of pixels.",
        category: "read_file" as const,
        inputSchema: { type: "object", properties: { direction: { type: "string" }, amount: { type: "number" } } },
        handler: scroll,
      },
      {
        name: "browser_evaluate",
        description: "Run JavaScript on the current page and return the result.",
        category: "run_code" as const,
        inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        handler: evaluate,
      },
      {
        name: "browser_close",
        description: "Close the current browser tab.",
        category: "write_file" as const,
        inputSchema: { type: "object", properties: {} },
        handler: closeTab,
      },
    ],
  };

  router.register(connector);
}
