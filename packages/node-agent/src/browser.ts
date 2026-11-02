import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import { isPrivateAddress, type BrowserHost, type PageInfo, type Screenshot } from "@harness/tools";

// The agent browser (docs/adr/0011-...): a headless Chromium in a temporary profile, a separate context for each conversation, that
// reaches only the public web. The pieces that decide what is allowed are plain functions so they can be tested without a browser.

// The few parts of Playwright this uses, so tests can stand in for it.
export interface PageLike {
  goto(url: string, options: { timeout: number; waitUntil: "domcontentloaded" }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  innerText(selector: string, options: { timeout: number }): Promise<string>;
  ariaSnapshot(): Promise<string>;
  click(target: string, timeout: number): Promise<void>;
  fill(target: string, text: string, timeout: number): Promise<void>;
  press(target: string, key: string, timeout: number): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  waitForLoad(): Promise<void>;
}

export interface ContextLike {
  page(): Promise<PageLike>;
  // Decides, for every request the pages make, whether it goes ahead.
  guard(allow: (url: string) => Promise<boolean>): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(): Promise<ContextLike>;
  close(): Promise<void>;
}

export interface BrowserOptions {
  launch: () => Promise<BrowserLike>;
  // Whether addresses on the local network are allowed (the same switch web_fetch uses).
  allowLocal: () => boolean;
  // Only these hosts (and their subdomains) may be visited, when the owner names any.
  allowedHosts: () => string[];
  // Looks a name up; replaced in tests.
  resolve?: (host: string) => Promise<string[]>;
  // How long a conversation's browser may sit unused before it is closed.
  idleMs?: number;
  now?: () => number;
  audit?: (summary: string) => void;
}

const NAVIGATION_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 8_000;
const MAX_SHOT_BYTES = 3 * 1024 * 1024;

export const hostAllowed = (host: string, allowed: string[]): boolean => {
  if (allowed.length === 0) {
    return true;
  }
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const name = a.trim().toLowerCase().replace(/^\*?\./, "");
    return name !== "" && (h === name || h.endsWith(`.${name}`));
  });
};

// Whether one request may go ahead. Only http and https; a host that is, or resolves to, a private address is refused unless the
// owner allowed local addresses; and if the owner named hosts, only those. Returns the reason when it is refused.
export const checkRequest = async (rawUrl: string, options: { allowLocal: boolean; allowedHosts: string[]; resolve: (host: string) => Promise<string[]> }): Promise<string | undefined> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "not a valid address";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${url.protocol} addresses are not allowed`;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostAllowed(host, options.allowedHosts)) {
    return `${host} is not one of the hosts the browser may visit`;
  }
  if (options.allowLocal) {
    return undefined;
  }
  if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost") || host.toLowerCase().endsWith(".local")) {
    return `${host} is on this machine or its network`;
  }
  const addresses = net.isIP(host)
    ? [host]
    : await options.resolve(host).catch((): string[] => {
        return [];
      });
  if (addresses.length === 0) {
    return `${host} could not be looked up`;
  }
  return addresses.some(isPrivateAddress) ? `${host} is on a private or local network, which the browser does not reach` : undefined;
};

// The Chrome, Edge or Chromium already on the machine; nothing is downloaded. BROWSER_PATH names one.
export const findBrowser = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = fs.existsSync): string | undefined => {
  const candidates = env.BROWSER_PATH
    ? [env.BROWSER_PATH]
    : platform === "win32"
      ? ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"].flatMap((base) => {
          const root = env[base];
          return root ? [`${root}\\Google\\Chrome\\Application\\chrome.exe`, `${root}\\Microsoft\\Edge\\Application\\msedge.exe`, `${root}\\Chromium\\Application\\chrome.exe`] : [];
        })
      : platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  return candidates.find((c) => {
    return exists(c);
  });
};

interface Held {
  context: ContextLike;
  page: PageLike;
  last: number;
}

export const createBrowser = (opts: BrowserOptions) => {
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? 15 * 60_000;
  const resolve = opts.resolve ?? (async (host: string) => {
    return (await dns.lookup(host, { all: true })).map((a) => {
      return a.address;
    });
  });
  const held = new Map<string, Held>();
  let browser: Promise<BrowserLike> | undefined;

  const allow = async (url: string): Promise<boolean> => {
    const reason = await checkRequest(url, { allowLocal: opts.allowLocal(), allowedHosts: opts.allowedHosts(), resolve });
    if (reason) {
      opts.audit?.(`browser refused ${url.slice(0, 120)}: ${reason}`);
    }
    return reason === undefined;
  };

  // One browser process for the whole agent, started when a conversation first needs it and ended when the last one is done.
  const start = (): Promise<BrowserLike> => {
    browser ??= opts.launch();
    return browser;
  };

  const forget = async (session: string): Promise<void> => {
    const entry = held.get(session);
    held.delete(session);
    await entry?.context.close().catch(() => {
      return undefined;
    });
    if (held.size === 0 && browser) {
      const closing = browser;
      browser = undefined;
      await closing.then((b) => {
        return b.close();
      }).catch(() => {
        return undefined;
      });
    }
  };

  const pageFor = async (session: string): Promise<PageLike> => {
    const existing = held.get(session);
    if (existing) {
      existing.last = now();
      return existing.page;
    }
    const context = await (await start()).newContext();
    await context.guard(allow);
    const page = await context.page();
    held.set(session, { context, page, last: now() });
    return page;
  };

  const info = async (page: PageLike, mode: "text" | "tree" = "text"): Promise<PageInfo> => {
    await page.waitForLoad().catch(() => {
      return undefined;
    });
    const text = mode === "tree"
      ? await page.ariaSnapshot().catch(() => {
          return "";
        })
      : await page.innerText("body", { timeout: ACTION_TIMEOUT_MS }).catch(() => {
          return "";
        });
    return { url: page.url(), title: await page.title().catch(() => {
      return "";
    }), text: text.trim() };
  };

  const host: BrowserHost & { sweep(): Promise<void>; closeAll(): Promise<void>; sessions(): number } = {
    async open(session, url) {
      const reason = await checkRequest(url, { allowLocal: opts.allowLocal(), allowedHosts: opts.allowedHosts(), resolve });
      if (reason) {
        throw new Error(`the browser will not open that: ${reason}`);
      }
      const page = await pageFor(session);
      await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      return info(page);
    },
    async read(session, mode) {
      return info(await pageFor(session), mode);
    },
    async click(session, target) {
      const page = await pageFor(session);
      await page.click(target, ACTION_TIMEOUT_MS);
      return info(page);
    },
    async type(session, target, text, submit) {
      const page = await pageFor(session);
      await page.fill(target, text, ACTION_TIMEOUT_MS);
      if (submit) {
        await page.press(target, "Enter", ACTION_TIMEOUT_MS);
      }
      return info(page);
    },
    async screenshot(session): Promise<Screenshot> {
      const page = await pageFor(session);
      const png = await page.screenshot();
      if (png.length > MAX_SHOT_BYTES) {
        throw new Error("that page is too large to screenshot");
      }
      return { mediaType: "image/png", data: Buffer.from(png).toString("base64"), url: page.url() };
    },
    async close(session) {
      await forget(session);
    },
    // Closes the browsers of conversations nobody has used for a while.
    async sweep() {
      for (const [session, h] of Array.from(held)) {
        if (now() - h.last > idleMs) {
          await forget(session);
        }
      }
    },
    async closeAll() {
      for (const session of Array.from(held.keys())) {
        await forget(session);
      }
    },
    sessions: () => {
      return held.size;
    },
  };
  return host;
};

export type AgentBrowser = ReturnType<typeof createBrowser>;
