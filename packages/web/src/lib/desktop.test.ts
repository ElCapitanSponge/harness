import { afterEach, describe, expect, it } from "vitest";
import { baseName, contextBlock, desktopApi, rootNameFor } from "./desktop";
import { readTextFiles } from "./pickfiles";

afterEach(() => {
  delete (window as unknown as { torii?: unknown }).torii;
});

describe("the desktop app's interface to the page", () => {
  it("is there only when the app says it is", () => {
    expect(desktopApi()).toBeUndefined();
    (window as unknown as { torii: unknown }).torii = { desktop: false };
    expect(desktopApi()).toBeUndefined();
    (window as unknown as { torii: unknown }).torii = { desktop: true, nodeId: "anakin" };
    expect(desktopApi()?.nodeId).toBe("anakin");
  });

  it("names a project folder from its path on any system", () => {
    expect(baseName(String.raw`C:\Users\andre\work\my-app`)).toBe("my-app");
    expect(baseName("/home/andre/work/my-app/")).toBe("my-app");
    expect(rootNameFor(String.raw`C:\Users\andre\My Projects`)).toBe("My-Projects");
    expect(rootNameFor("/")).toBe("project");
  });
});

describe("a file as a block in a message", () => {
  it("is the path, then the text in a code fence", () => {
    expect(contextBlock("src/a.ts", "const a = 1;\n")).toBe("src/a.ts:\n```\nconst a = 1;\n```");
  });

  it("uses a longer fence when the text has fences of its own, so it cannot be cut short", () => {
    const block = contextBlock("README.md", "Use:\n```ts\nx\n```\n");
    expect(block.startsWith("README.md:\n````\n")).toBe(true);
    expect(block.endsWith("\n````")).toBe(true);
  });
});

describe("files given to a browser page", () => {
  it("reads text, and says why a big file or a binary file was not read", async () => {
    const big = new File(["x".repeat(200_001)], "big.txt");
    const bin = new File(["a\u0000b"], "a.bin");
    const ok = new File(["hello"], "notes.txt");
    const [a, b, c] = await readTextFiles([ok, big, bin]);
    expect(a).toEqual({ path: "notes.txt", name: "notes.txt", content: "hello" });
    expect(b?.problem).toContain("larger than 200 KB");
    expect(c?.problem).toContain("binary");
  });
});
