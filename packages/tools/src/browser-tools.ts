import { show, str, truncate, type ToolSpec } from "./helpers.js";

// Tools for the agent browser: a throwaway headless browser a device can offer, off unless the owner turns it on. The browser itself
// lives in the node agent (docs/adr/0011-...); these tools call it through the context. What it isolates and may reach is in the ADR.

export interface PageInfo {
  url: string;
  title: string;
  // The page as text, or as an accessibility tree.
  text: string;
}

export interface Screenshot {
  mediaType: "image/png" | "image/jpeg";
  // Base64.
  data: string;
  url: string;
}

export interface BrowserHost {
  open: (session: string, url: string) => Promise<PageInfo>;
  read: (session: string, mode: "text" | "tree") => Promise<PageInfo>;
  click: (session: string, target: string) => Promise<PageInfo>;
  type: (session: string, target: string, text: string, submit: boolean) => Promise<PageInfo>;
  screenshot: (session: string) => Promise<Screenshot>;
  close: (session: string) => Promise<void>;
}

const MAX_PAGE_TEXT = 12_000;

const page = (verb: string, info: PageInfo): string => {
  return truncate(`${verb} ${info.url}${info.title ? ` - "${info.title}"` : ""}\n\n${info.text}`, MAX_PAGE_TEXT);
};

const hostOf = (ctx: { browser?: BrowserHost; session?: string }): { host: BrowserHost; session: string } => {
  if (!ctx.browser) {
    throw new Error("the browser is not available on this device (the owner has to turn it on)");
  }
  return { host: ctx.browser, session: ctx.session ?? "local" };
};

const spec = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec["def"] => {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
};

const base = { group: "remote", optIn: "browser" } as const;

const open: ToolSpec = {
  ...base,
  def: spec("browser_open", "Open a web page in a real, sandboxed browser (it runs JavaScript) and read it. Use it for pages the plain fetch tool cannot read. Only public web pages work: local network addresses and files are refused.", { url: { type: "string", description: "An http or https address" } }, ["url"]),
  needsApproval: true,
  level: "change",
  describe: (a) => {
    return `browser: open ${show(a.url)}`;
  },
  async run(a, ctx) {
    const { host, session } = hostOf(ctx);
    return page("Opened", await host.open(session, str(a, "url")));
  },
};

const read: ToolSpec = {
  ...base,
  def: spec("browser_read", "Read the page the browser is on again, as text or as an accessibility tree (use the tree to find what to click or type into).", { mode: { type: "string", enum: ["text", "tree"], description: "text (default) or tree" } }, []),
  needsApproval: false,
  level: "read",
  describe: (a) => {
    return `browser: read the page (${show(a.mode, "text")})`;
  },
  async run(a, ctx) {
    const { host, session } = hostOf(ctx);
    return page("Page", await host.read(session, a.mode === "tree" ? "tree" : "text"));
  },
};

const click: ToolSpec = {
  ...base,
  def: spec("browser_click", "Click something on the page, named by its visible text or by a CSS selector. A click can submit a form.", { target: { type: "string", description: "Visible text, or a CSS selector" } }, ["target"]),
  needsApproval: true,
  level: "change",
  describe: (a) => {
    return `browser: click ${show(a.target)}`;
  },
  async run(a, ctx) {
    const { host, session } = hostOf(ctx);
    return page("Clicked; now at", await host.click(session, str(a, "target")));
  },
};

const type: ToolSpec = {
  ...base,
  def: spec("browser_type", "Type text into a field on the page, named by its label, placeholder or a CSS selector. With submit, press Enter afterwards.", {
    target: { type: "string", description: "The field's label or placeholder, or a CSS selector" },
    text: { type: "string" },
    submit: { type: "boolean", description: "Press Enter after typing" },
  }, ["target", "text"]),
  needsApproval: true,
  level: "change",
  describe: (a) => {
    return `browser: type into ${show(a.target)}${a.submit === true ? " and submit" : ""}`;
  },
  async run(a, ctx) {
    const { host, session } = hostOf(ctx);
    return page("Typed; now at", await host.type(session, str(a, "target"), str(a, "text"), a.submit === true));
  },
};

const screenshot: ToolSpec = {
  ...base,
  def: spec("browser_screenshot", "Take a screenshot of the page. The person sees it in their side panel; you are only told that it was taken, so use browser_read to know what is on the page.", {}, []),
  needsApproval: false,
  level: "read",
  describe: () => {
    return "browser: take a screenshot";
  },
  async run(_a, ctx) {
    const { host, session } = hostOf(ctx);
    const shot = await host.screenshot(session);
    if (!ctx.image) {
      return `took a screenshot of ${shot.url}, but there is nowhere to show it here`;
    }
    ctx.image(shot);
    return `took a screenshot of ${shot.url}; the person can see it`;
  },
};

const close: ToolSpec = {
  ...base,
  def: spec("browser_close", "Close the browser for this conversation and forget everything in it.", {}, []),
  needsApproval: false,
  level: "read",
  describe: () => {
    return "browser: close";
  },
  async run(_a, ctx) {
    const { host, session } = hostOf(ctx);
    await host.close(session);
    return "the browser is closed";
  },
};

export const browserTools: ToolSpec[] = [open, read, click, type, screenshot, close];
