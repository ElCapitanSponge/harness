import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { MAX_OUTPUT, show, str, truncate, type ToolSpec } from "./helpers.js";

// Fetching a page for the model. The model chooses the address, so this must not be a way into the owner's own network: an
// address that is private, loopback, link-local or in the tailnet range is refused at the moment of connecting (so a name that
// changes its answer between a check and a connection gains nothing), on every redirect, unless the owner allowed it.

const MAX_BYTES = 200_000;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const v4Blocked = (a: number, b: number): boolean => {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
};

// True for an address that is not on the public internet: this machine, the local network, link-local (including cloud metadata),
// carrier-grade NAT (which Tailscale uses), multicast and the unspecified address.
export const isPrivateAddress = (address: string): boolean => {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return v4Blocked(a, b);
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) {
      return isPrivateAddress(mapped[1]);
    }
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true;
};

const allowLocal = (): boolean => {
  return process.env.WEB_FETCH_ALLOW_LOCAL === "1";
};

// A lookup that fails for a name that resolves to a private address, used when the connection is made.
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void): void => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "");
      return;
    }
    const list = addresses;
    const blocked = !allowLocal() && list.some((a) => {
      return isPrivateAddress(a.address);
    });
    if (blocked || list.length === 0) {
      callback(Object.assign(new Error(`"${hostname}" is on a private or local network, which web_fetch does not reach`), { code: "EBLOCKED" }), "");
      return;
    }
    if (options.all) {
      callback(null, list);
    } else {
      callback(null, list[0]?.address ?? "", list[0]?.family);
    }
  });
}) as unknown as (hostname: string, options: object, callback: (...args: unknown[]) => void) => void;

const agent = new Agent({ connect: { lookup: safeLookup as never } });

// Plain text from an HTML page: scripts, styles and tags go, a few entities are decoded, whitespace is tidied.
export const htmlToText = (html: string): string => {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
};

const TEXTUAL = /^(text\/|application\/(json|xml|xhtml|javascript|x-yaml|yaml|toml|rss|atom)|[\w.+-]+\/[\w.+-]*(\+json|\+xml))/i;

export interface FetchedPage {
  status: number;
  url: string;
  type: string;
  text: string;
  shownBytes: number;
  truncated: boolean;
}

// Fetches one address, following redirects itself so each hop is checked, and reads at most `maxBytes` of a text response.
export const fetchPage = async (rawUrl: string, maxBytes: number = MAX_BYTES): Promise<FetchedPage> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`"${rawUrl}" is not a valid address`);
  }
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`only http and https addresses can be fetched, not ${url.protocol}`);
    }
    // An address given as a number is checked here, because it needs no lookup.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isPrivateAddress(literal) && !allowLocal()) {
      throw new Error(`"${url.hostname}" is on a private or local network, which web_fetch does not reach`);
    }
    const res = await undiciFetch(url, {
      redirect: "manual",
      dispatcher: agent,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Torii-web_fetch/1.0", "accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location") ?? "", url);
      await res.body?.cancel();
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !TEXTUAL.test(type)) {
      await res.body?.cancel();
      throw new Error(`the response is ${type}, which is not text, so it is not shown`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const part = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
        if (part.done) {
          break;
        }
        size += part.value.length;
        chunks.push(part.value);
        if (size > maxBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    }
    const raw = Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
    return { status: res.status, url: url.toString(), type, text: /html/i.test(type) ? htmlToText(raw) : raw, shownBytes: Math.min(size, maxBytes), truncated };
  }
  throw new Error(`more than ${String(MAX_REDIRECTS)} redirects`);
};

export const webFetch: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a web page or API over http(s) and return its text (HTML is reduced to plain text). Cannot reach local or private network addresses.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The address, starting with http:// or https://" } },
        required: ["url"],
      },
    },
  },
  // A page address can carry information out (a query string with file contents in it), so each fetch is shown first.
  needsApproval: true,
  describe: (a) => {
    return `fetch ${show(a.url)}`;
  },
  async run(a) {
    const page = await fetchPage(str(a, "url"));
    const note = page.truncated ? ` (first ${String(page.shownBytes)} bytes)` : "";
    return truncate(`HTTP ${String(page.status)} ${page.type || "unknown type"}${note} ${page.url}\n\n${page.text}`, MAX_OUTPUT);
  },
};
