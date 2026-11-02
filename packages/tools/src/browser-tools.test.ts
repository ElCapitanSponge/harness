import { describe, expect, it, vi } from "vitest";
import type { BrowserHost, PageInfo, Screenshot } from "./browser-tools.js";
import { findTool, toolNamesFor, tools } from "./tools.js";

const page: PageInfo = { url: "https://example.com/", title: "Example", text: "Hello there" };

const host = (): BrowserHost => {
  return {
    open: vi.fn(() => {
      return Promise.resolve(page);
    }),
    read: vi.fn(() => {
      return Promise.resolve(page);
    }),
    click: vi.fn(() => {
      return Promise.resolve(page);
    }),
    type: vi.fn(() => {
      return Promise.resolve(page);
    }),
    screenshot: vi.fn((): Promise<Screenshot> => {
      return Promise.resolve({ mediaType: "image/png", data: "AAAA", url: page.url });
    }),
    close: vi.fn(() => {
      return Promise.resolve();
    }),
  };
};

const run = (name: string, args: Record<string, unknown>, ctx: { browser?: BrowserHost; image?: (s: Screenshot) => void } = {}): Promise<string> => {
  const tool = findTool(name);
  if (!tool) {
    throw new Error(`no tool ${name}`);
  }
  return tool.run(args, { cwd: ".", session: "s1", ...ctx });
};

describe("the browser tools", () => {
  it("are an opt-in of their own: no tool group offers them", () => {
    for (const level of ["off", "read", "change"] as const) {
      expect(toolNamesFor(level, level).filter((n) => {
        return n.startsWith("browser_");
      })).toEqual([]);
    }
    expect(tools.filter((t) => {
      return t.optIn === "browser";
    }).map((t) => {
      return t.def.function.name;
    })).toEqual(["browser_open", "browser_read", "browser_click", "browser_type", "browser_screenshot", "browser_close"]);
  });

  it("ask before opening a page, clicking or typing, and not before reading, a screenshot or closing", () => {
    const asks = Object.fromEntries(tools.filter((t) => {
      return t.optIn === "browser";
    }).map((t) => {
      return [t.def.function.name, t.needsApproval];
    }));
    expect(asks).toEqual({ browser_open: true, browser_read: false, browser_click: true, browser_type: true, browser_screenshot: false, browser_close: false });
  });

  it("open a page and read it back with its address and title, for the conversation they belong to", async () => {
    const browser = host();
    expect(await run("browser_open", { url: "https://example.com" }, { browser })).toBe("Opened https://example.com/ - \"Example\"\n\nHello there");
    expect(browser.open).toHaveBeenCalledWith("s1", "https://example.com");
    await run("browser_read", { mode: "tree" }, { browser });
    expect(browser.read).toHaveBeenCalledWith("s1", "tree");
    await run("browser_click", { target: "Sign in" }, { browser });
    await run("browser_type", { target: "Email", text: "me@example.com", submit: true }, { browser });
    expect(browser.click).toHaveBeenCalledWith("s1", "Sign in");
    expect(browser.type).toHaveBeenCalledWith("s1", "Email", "me@example.com", true);
  });

  it("send a screenshot to the person and tell the model only that one was taken", async () => {
    const image = vi.fn();
    const reply = await run("browser_screenshot", {}, { browser: host(), image });
    expect(image).toHaveBeenCalledWith({ mediaType: "image/png", data: "AAAA", url: page.url });
    expect(reply).toBe("took a screenshot of https://example.com/; the person can see it");
    expect(reply).not.toContain("AAAA");
  });

  it("say plainly that the browser is not available when the device has not turned it on", async () => {
    await expect(run("browser_open", { url: "https://example.com" })).rejects.toThrow("not available on this device");
  });
});
