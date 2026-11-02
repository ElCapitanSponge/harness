import { describe, expect, it, vi } from "vitest";
import { checkRequest, createBrowser, findBrowser, hostAllowed, type BrowserLike, type ContextLike, type PageLike } from "./browser.js";

const resolver = (table: Record<string, string[]>) => {
  return (host: string): Promise<string[]> => {
    const found = table[host];
    return found ? Promise.resolve(found) : Promise.reject(new Error("ENOTFOUND"));
  };
};

const rules = (over: Partial<Parameters<typeof checkRequest>[1]> = {}) => {
  return { allowLocal: false, allowedHosts: [], resolve: resolver({ "example.com": ["93.184.216.34"], "intranet.corp": ["10.1.2.3"], "mixed.example": ["93.184.216.34", "192.168.1.5"] }), ...over };
};

describe("what the agent browser may reach", () => {
  it("allows a public http or https address", async () => {
    expect(await checkRequest("https://example.com/page?x=1", rules())).toBeUndefined();
    expect(await checkRequest("http://93.184.216.34/", rules())).toBeUndefined();
  });

  it("refuses files and every other scheme", async () => {
    for (const url of ["file:///C:/Windows/win.ini", "ftp://example.com/x", "chrome://settings", "data:text/html,hi", "javascript:alert(1)", "about:blank"]) {
      expect(await checkRequest(url, rules()), url).toContain("not allowed");
    }
    expect(await checkRequest("not a url", rules())).toBe("not a valid address");
  });

  it("refuses addresses on this machine or the local network, by number or by name, and a name with any private answer", async () => {
    for (const url of ["http://127.0.0.1:8787/", "http://localhost/", "http://app.localhost/", "http://printer.local/", "http://192.168.1.10/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://100.106.71.39/", "http://[::1]/", "http://intranet.corp/", "http://mixed.example/"]) {
      expect(await checkRequest(url, rules()), url).toBeTruthy();
    }
    expect(await checkRequest("http://nowhere.invalid/", rules())).toContain("could not be looked up");
  });

  it("lets the local network through only when the owner allowed it", async () => {
    expect(await checkRequest("http://192.168.1.10/", rules({ allowLocal: true }))).toBeUndefined();
    expect(await checkRequest("http://intranet.corp/", rules({ allowLocal: true }))).toBeUndefined();
    // Files are still refused.
    expect(await checkRequest("file:///etc/passwd", rules({ allowLocal: true }))).toContain("not allowed");
  });

  it("goes only to the hosts the owner named, and their subdomains, when any are named", async () => {
    expect(hostAllowed("docs.example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("notexample.com", ["example.com"])).toBe(false);
    expect(hostAllowed("anything.org", [])).toBe(true);
    expect(await checkRequest("https://example.com/", rules({ allowedHosts: ["other.org"] }))).toContain("not one of the hosts");
    expect(await checkRequest("https://example.com/", rules({ allowedHosts: ["example.com"] }))).toBeUndefined();
  });
});

describe("finding a browser", () => {
  it("takes BROWSER_PATH if it names one, otherwise the usual places, and nothing is downloaded", () => {
    expect(findBrowser("win32", { BROWSER_PATH: "D:\\chrome.exe" }, (f) => {
      return f === "D:\\chrome.exe";
    })).toBe("D:\\chrome.exe");
    expect(findBrowser("win32", { ProgramFiles: "C:\\Program Files" }, (f) => {
      return f.endsWith("msedge.exe");
    })).toBe("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(findBrowser("darwin", {}, (f) => {
      return f.includes("Google Chrome");
    })).toContain("Google Chrome");
    expect(findBrowser("linux", {}, (f) => {
      return f === "/usr/bin/chromium";
    })).toBe("/usr/bin/chromium");
    expect(findBrowser("linux", {}, () => {
      return false;
    })).toBeUndefined();
  });
});

// A stand-in for the browser, recording what happens to it.
const fake = () => {
  const log: string[] = [];
  let allow: ((url: string) => Promise<boolean>) | undefined;
  const page = (name: string): PageLike => {
    return {
      goto: (url) => {
        log.push(`${name} goto ${url}`);
        return Promise.resolve();
      },
      url: () => {
        return "https://example.com/";
      },
      title: () => {
        return Promise.resolve("Example");
      },
      innerText: () => {
        return Promise.resolve(" Hello ");
      },
      ariaSnapshot: () => {
        return Promise.resolve("- heading");
      },
      click: (target) => {
        log.push(`${name} click ${target}`);
        return Promise.resolve();
      },
      fill: (target, text) => {
        log.push(`${name} fill ${target}=${text}`);
        return Promise.resolve();
      },
      press: (target, key) => {
        log.push(`${name} press ${key}`);
        return Promise.resolve();
      },
      screenshot: () => {
        return Promise.resolve(new Uint8Array([137, 80, 78, 71]));
      },
      waitForLoad: () => {
        return Promise.resolve();
      },
    };
  };
  let contexts = 0;
  const browser: BrowserLike = {
    newContext: () => {
      const n = ++contexts;
      const context: ContextLike = {
        page: () => {
          return Promise.resolve(page(`c${String(n)}`));
        },
        guard: (fn) => {
          allow = fn;
          return Promise.resolve();
        },
        close: () => {
          log.push(`c${String(n)} closed`);
          return Promise.resolve();
        },
      };
      return Promise.resolve(context);
    },
    close: () => {
      log.push("browser closed");
      return Promise.resolve();
    },
  };
  const launch = vi.fn(() => {
    return Promise.resolve(browser);
  });
  return { log, launch, allow: (url: string) => {
    return allow?.(url) ?? Promise.resolve(false);
  } };
};

const make = (f: ReturnType<typeof fake>, over: { allowLocal?: boolean; now?: () => number; audit?: (s: string) => void } = {}) => {
  return createBrowser({ launch: f.launch, allowLocal: () => {
    return over.allowLocal ?? false;
  }, allowedHosts: () => {
    return [];
  }, resolve: resolver({ "example.com": ["93.184.216.34"] }), now: over.now, audit: over.audit, idleMs: 1000 });
};

describe("the agent browser", () => {
  it("starts nothing until a page is opened, then opens it in a context of its own and reads it", async () => {
    const f = fake();
    const browser = make(f);
    expect(f.launch).not.toHaveBeenCalled();
    const page = await browser.open("s1", "https://example.com/");
    expect(page).toEqual({ url: "https://example.com/", title: "Example", text: "Hello" });
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.log).toContain("c1 goto https://example.com/");
  });

  it("gives each conversation its own context, so nothing is shared between them, but one browser process", async () => {
    const f = fake();
    const browser = make(f);
    await browser.open("s1", "https://example.com/");
    await browser.open("s2", "https://example.com/");
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.log).toEqual(expect.arrayContaining(["c1 goto https://example.com/", "c2 goto https://example.com/"]));
    expect(browser.sessions()).toBe(2);
  });

  it("refuses to open a local address, without opening a context at all", async () => {
    const f = fake();
    const browser = make(f);
    await expect(browser.open("s1", "http://127.0.0.1:8787/")).rejects.toThrow("will not open that");
    await expect(browser.open("s1", "file:///etc/passwd")).rejects.toThrow("not allowed");
    expect(f.launch).not.toHaveBeenCalled();
  });

  it("checks every request the page makes, not only the first, and records what it refused", async () => {
    const f = fake();
    const audit = vi.fn();
    const browser = make(f, { audit });
    await browser.open("s1", "https://example.com/");
    expect(await f.allow("https://example.com/app.js")).toBe(true);
    expect(await f.allow("http://192.168.1.1/admin")).toBe(false);
    expect(await f.allow("file:///C:/secret.txt")).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.stringContaining("browser refused http://192.168.1.1/admin"));
  });

  it("clicks, types and screenshots, and a screenshot is the picture as base64", async () => {
    const f = fake();
    const browser = make(f);
    await browser.open("s1", "https://example.com/");
    await browser.click("s1", "Sign in");
    await browser.type("s1", "Email", "me@example.com", true);
    expect(f.log).toEqual(expect.arrayContaining(["c1 click Sign in", "c1 fill Email=me@example.com", "c1 press Enter"]));
    expect(await browser.screenshot("s1")).toEqual({ mediaType: "image/png", data: Buffer.from([137, 80, 78, 71]).toString("base64"), url: "https://example.com/" });
    expect((await browser.read("s1", "tree")).text).toBe("- heading");
  });

  it("closes a conversation's context, and the browser itself when the last one is gone", async () => {
    const f = fake();
    const browser = make(f);
    await browser.open("s1", "https://example.com/");
    await browser.open("s2", "https://example.com/");
    await browser.close("s1");
    expect(f.log).toContain("c1 closed");
    expect(f.log).not.toContain("browser closed");
    await browser.close("s2");
    expect(f.log).toContain("browser closed");
    expect(browser.sessions()).toBe(0);

    // A later page starts a fresh browser rather than reusing a closed one.
    await browser.open("s3", "https://example.com/");
    expect(f.launch).toHaveBeenCalledTimes(2);
  });

  it("closes conversations nobody has used for a while, and everything on request", async () => {
    const f = fake();
    let time = 0;
    const browser = make(f, { now: () => {
      return time;
    } });
    await browser.open("old", "https://example.com/");
    time = 900;
    await browser.open("new", "https://example.com/");
    time = 1500;
    await browser.sweep();
    expect(browser.sessions()).toBe(1);
    expect(f.log).toContain("c1 closed");
    await browser.closeAll();
    expect(browser.sessions()).toBe(0);
    expect(f.log).toContain("browser closed");
  });
});
