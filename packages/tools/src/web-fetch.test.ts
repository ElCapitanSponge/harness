import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchPage, htmlToText, isPrivateAddress, webFetch } from "./web-fetch.js";

describe("which addresses are private", () => {
  it.each([
    "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.7", "169.254.169.254", "100.83.115.110", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:192.168.1.1", "::ffff:127.0.0.1", "not an address",
  ])("%s is refused", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("htmlToText", () => {
  it("drops scripts, styles and tags, keeps the words, and decodes the common entities", () => {
    const text = htmlToText("<html><head><title>x</title><style>p{}</style></head><body><h1>Title</h1><p>Fish &amp; chips</p><script>alert(1)</script><p>Next</p></body></html>");
    expect(text).toBe("Title\n Fish & chips\n Next");
  });
});

describe("fetching a page", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/page") {
        res.setHeader("content-type", "text/html");
        res.end("<p>Hello <b>world</b></p>");
      } else if (req.url === "/json") {
        res.setHeader("content-type", "application/json");
        res.end("{\"a\":1}");
      } else if (req.url === "/go") {
        res.statusCode = 302;
        res.setHeader("location", "/page");
        res.end();
      } else if (req.url === "/loop") {
        res.statusCode = 302;
        res.setHeader("location", "/loop");
        res.end();
      } else if (req.url === "/binary") {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from([1, 2, 3]));
      } else if (req.url === "/big") {
        res.setHeader("content-type", "text/plain");
        res.end("x".repeat(500_000));
      } else {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain");
        res.end("nothing here");
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  afterEach(() => {
    delete process.env.WEB_FETCH_ALLOW_LOCAL;
  });

  it("refuses this machine and the local network by default, by number and by name", async () => {
    await expect(fetchPage(`${base}/page`)).rejects.toThrow("private or local network");
    await expect(fetchPage(`http://localhost:${base.split(":")[2] ?? ""}/page`)).rejects.toThrow();
    await expect(fetchPage("http://192.168.1.7:8787/")).rejects.toThrow("private or local network");
    await expect(fetchPage("http://[::1]/")).rejects.toThrow("private or local network");
  });

  it("refuses an address that is not http or https", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow("only http and https");
    await expect(fetchPage("ftp://example.com/x")).rejects.toThrow("only http and https");
    await expect(fetchPage("not a url")).rejects.toThrow("not a valid address");
  });

  it("reads a page as text when the owner has allowed local addresses, following a redirect", async () => {
    process.env.WEB_FETCH_ALLOW_LOCAL = "1";
    expect(await fetchPage(`${base}/page`)).toMatchObject({ status: 200, text: "Hello world", type: "text/html" });
    expect(await fetchPage(`${base}/go`)).toMatchObject({ url: `${base}/page`, text: "Hello world" });
    expect((await fetchPage(`${base}/json`)).text).toBe("{\"a\":1}");
    expect(await fetchPage(`${base}/missing`)).toMatchObject({ status: 404, text: "nothing here" });
  });

  it("stops at a redirect loop, a response that is not text, and a very large one", async () => {
    process.env.WEB_FETCH_ALLOW_LOCAL = "1";
    await expect(fetchPage(`${base}/loop`)).rejects.toThrow("redirects");
    await expect(fetchPage(`${base}/binary`)).rejects.toThrow("not text");
    const big = await fetchPage(`${base}/big`, 1000);
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBe(1000);
  });

  it("is a tool that asks every time and reports what it fetched", async () => {
    process.env.WEB_FETCH_ALLOW_LOCAL = "1";
    expect(webFetch.needsApproval).toBe(true);
    expect(webFetch.describe({ url: "https://example.com/a" })).toBe("fetch https://example.com/a");
    const out = await webFetch.run({ url: `${base}/page` }, { cwd: "." });
    expect(out).toContain("HTTP 200 text/html");
    expect(out).toContain("Hello world");
  });
});
