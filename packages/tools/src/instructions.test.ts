import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ABSENT } from "./instructions.js";
import { INSTRUCTION_LIMIT, instructionFits } from "@harness/core";
import { MAX_OUTPUT } from "./helpers.js";
import { findTool } from "./tools.js";

let base: string;
let root: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "harness-instructions-"));
  root = path.join(base, "project");
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const run = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const tool = findTool(name);
  if (!tool) {
    throw new Error(`no tool ${name}`);
  }
  return JSON.parse(await tool.run(args, { cwd: root })) as Record<string, unknown>;
};

const open = async (name: string): Promise<{ text: string; version: string; exists: boolean }> => {
  const got = await run("read_instruction", { name });
  return { text: got.text as string, version: got.version as string, exists: got.exists as boolean };
};

describe("read_instruction", () => {
  it("gives the text of the file and its version", async () => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Use pnpm.\n", "utf8");
    const got = await open("AGENTS.md");
    expect(got).toMatchObject({ exists: true, text: "Use pnpm.\n" });
    expect(got.version).not.toBe(ABSENT);
  });

  it("says so when the file is not there, so it can be created", async () => {
    expect(await run("read_instruction", { name: "AGENTS.md" })).toEqual({ name: "AGENTS.md", exists: false, text: "", version: ABSENT });
  });

  it("refuses any name but the two, and any path", async () => {
    await fs.writeFile(path.join(base, "AGENTS.md"), "outside", "utf8");
    await fs.writeFile(path.join(root, "package.json"), "{}", "utf8");
    for (const name of ["package.json", "../AGENTS.md", "docs/AGENTS.md", "agents.md", "", "AGENTS.md/"]) {
      await expect(run("read_instruction", { name }), name).rejects.toThrow("can be read or changed here");
    }
  });

  it("counts the limit the page counts, which is the most a tool may return, and counts what escaping adds", () => {
    expect(INSTRUCTION_LIMIT).toBe(MAX_OUTPUT);
    expect(instructionFits("AGENTS.md", "x".repeat(1000))).toBe(true);
    expect(instructionFits("AGENTS.md", "x".repeat(MAX_OUTPUT))).toBe(false);
    expect(instructionFits("AGENTS.md", "\n".repeat(MAX_OUTPUT / 2))).toBe(false);
  });

  it("refuses a file too long to open whole, and does not cut it", async () => {
    await fs.writeFile(path.join(root, "CLAUDE.md"), "x".repeat(MAX_OUTPUT + 5), "utf8");
    await expect(run("read_instruction", { name: "CLAUDE.md" })).rejects.toThrow("too long to edit here");
    // Escaping makes the text longer than the file: this one is under the limit on disk and over it as it is sent.
    await fs.writeFile(path.join(root, "CLAUDE.md"), "\n".repeat(MAX_OUTPUT - 100), "utf8");
    await expect(run("read_instruction", { name: "CLAUDE.md" })).rejects.toThrow("too long to edit here");
  });

  it("refuses a file that is not text", async () => {
    await fs.writeFile(path.join(root, "AGENTS.md"), Buffer.from([0x61, 0x00, 0x62]));
    await expect(run("read_instruction", { name: "AGENTS.md" })).rejects.toThrow("not a text file");
  });

  it("refuses a link that leads out of the project", async (ctx) => {
    await fs.writeFile(path.join(base, "secret.md"), "outside", "utf8");
    try {
      await fs.symlink(path.join(base, "secret.md"), path.join(root, "AGENTS.md"));
    } catch {
      // Making a link needs a privilege on some systems.
      ctx.skip();
    }
    await expect(run("read_instruction", { name: "AGENTS.md" })).rejects.toThrow("outside the working directory");
    await expect(run("write_instruction", { name: "AGENTS.md", text: "x", version: "1-1" })).rejects.toThrow("outside the working directory");
    expect(await fs.readFile(path.join(base, "secret.md"), "utf8")).toBe("outside");
  });
});

describe("write_instruction", () => {
  it("saves the text and gives the new version", async () => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Use pnpm.\n", "utf8");
    const opened = await open("AGENTS.md");
    const saved = await run("write_instruction", { name: "AGENTS.md", text: "Use pnpm.\nRun the tests.\n", version: opened.version });
    expect(saved).toMatchObject({ saved: true, length: 25 });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("Use pnpm.\nRun the tests.\n");
    // The version it gave is the file's now, so the next save from the same page goes through.
    expect((await open("AGENTS.md")).version).toBe(saved.version);
    expect(await run("write_instruction", { name: "AGENTS.md", text: "Again.\n", version: saved.version })).toMatchObject({ saved: true });
  });

  it("refuses to save over a file that changed after it was opened, and leaves it as it is", async () => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "one", "utf8");
    const opened = await open("AGENTS.md");
    await fs.writeFile(path.join(root, "AGENTS.md"), "changed by someone else", "utf8");
    const refused = await run("write_instruction", { name: "AGENTS.md", text: "mine", version: opened.version });
    expect(refused).toMatchObject({ saved: false, conflict: true, message: expect.stringContaining("changed on disk") as string });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("changed by someone else");
  });

  it("creates the file when there was none, and refuses if one has appeared since", async () => {
    const created = await run("write_instruction", { name: "AGENTS.md", text: "# Rules\n", version: ABSENT });
    expect(created).toMatchObject({ saved: true });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("# Rules\n");
    const late = await run("write_instruction", { name: "AGENTS.md", text: "mine", version: ABSENT });
    expect(late).toMatchObject({ saved: false, conflict: true, message: expect.stringContaining("created after") as string });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("# Rules\n");
  });

  it("refuses to save a file that was removed after it was opened", async () => {
    await fs.writeFile(path.join(root, "CLAUDE.md"), "gone soon", "utf8");
    const opened = await open("CLAUDE.md");
    await fs.rm(path.join(root, "CLAUDE.md"));
    expect(await run("write_instruction", { name: "CLAUDE.md", text: "mine", version: opened.version })).toMatchObject({ saved: false, conflict: true, message: expect.stringContaining("removed") as string });
    await expect(fs.access(path.join(root, "CLAUDE.md"))).rejects.toThrow();
  });

  it("keeps the line endings the file had", async () => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "one\r\ntwo\r\n", "utf8");
    const opened = await open("AGENTS.md");
    // The browser gives the text back with plain line feeds.
    await run("write_instruction", { name: "AGENTS.md", text: "one\ntwo\nthree\n", version: opened.version });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("one\r\ntwo\r\nthree\r\n");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "one\ntwo\n", "utf8");
    const lf = await open("CLAUDE.md");
    await run("write_instruction", { name: "CLAUDE.md", text: "one\r\ntwo\r\n", version: lf.version });
    expect(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe("one\ntwo\n");
  });

  it("refuses any other name or path, and writes nothing", async () => {
    for (const name of ["package.json", "../AGENTS.md", "docs/CLAUDE.md"]) {
      await expect(run("write_instruction", { name, text: "x", version: ABSENT }), name).rejects.toThrow("can be read or changed here");
    }
    expect(await fs.readdir(root)).toEqual([]);
    expect(await fs.readdir(base)).toEqual(["project"]);
  });

  it("refuses text the page could not open again, and writes nothing", async () => {
    await expect(run("write_instruction", { name: "AGENTS.md", text: "x".repeat(MAX_OUTPUT), version: ABSENT })).rejects.toThrow("too long to edit here");
    await expect(run("write_instruction", { name: "AGENTS.md", text: "a\u0000b", version: ABSENT })).rejects.toThrow("null character");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("leaves no temporary file behind", async () => {
    await run("write_instruction", { name: "AGENTS.md", text: "one", version: ABSENT });
    expect(await fs.readdir(root)).toEqual(["AGENTS.md"]);
  });
});

describe("the instruction tools", () => {
  it("are not offered to the model, and only a save asks for the device to allow changes", () => {
    expect(findTool("read_instruction")).toMatchObject({ hidden: true, group: "device", level: "read", needsApproval: false });
    expect(findTool("write_instruction")).toMatchObject({ hidden: true, group: "device", level: "change", needsApproval: false });
  });
});
