import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryError, MAX_FILES, createLibrary, filesFromZip } from "./library.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "library-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const skillMd = (name: string, description = "Test first.", body = "Write the test. $ARGUMENTS", extra = ""): Uint8Array => {
  return strToU8(`---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`);
};

const zipOf = (files: Record<string, Uint8Array>): Uint8Array => {
  return zipSync(files);
};

describe("the library", () => {
  it("adds a skill from a zip with the skill at the top, or in the one folder that holds it, and lists it with its size", async () => {
    const library = createLibrary(path.join(dir, "skills"));
    const added = await library.addZip(zipOf({ "SKILL.md": skillMd("tdd"), "REFERENCE.md": strToU8("reference") }));
    expect(added).toMatchObject({ name: "tdd", description: "Test first.", modelInvocable: true, files: 2, source: "library" });

    await library.addZip(zipOf({ "wizard/SKILL.md": skillMd("wizard", "Walk through steps."), "wizard/notes/more.md": strToU8("more"), "__MACOSX/._x": strToU8("junk"), "wizard/.DS_Store": strToU8("junk") }));
    const listed = await library.list();
    expect(listed.map((s) => {
      return `${s.name}:${String(s.files)}`;
    })).toEqual(["tdd:2", "wizard:2"]);
  });

  it("adds a skill from a set of files, such as a folder chosen in the page", async () => {
    const library = createLibrary(dir);
    const added = await library.add(new Map([["my-skill/SKILL.md", skillMd("my-skill")], ["my-skill/helper.txt", strToU8("x")]]));
    expect(added.name).toBe("my-skill");
  });

  it("keeps a skill that is already there unless told to replace it", async () => {
    const library = createLibrary(dir);
    await library.add(new Map([["SKILL.md", skillMd("tdd", "First.")]]));
    await expect(library.add(new Map([["SKILL.md", skillMd("tdd", "Second.")]]))).rejects.toThrow("already has a skill named \"tdd\"");
    expect((await library.list())[0]?.description).toBe("First.");
    await library.add(new Map([["SKILL.md", skillMd("tdd", "Second.")], ["extra.md", strToU8("x")]]), { overwrite: true });
    expect((await library.list())[0]).toMatchObject({ description: "Second.", files: 2 });
  });

  it("refuses a skill with no SKILL.md, no name or description, or an unusable name, saying why, and saves nothing", async () => {
    const library = createLibrary(dir);
    await expect(library.add(new Map([["readme.md", strToU8("x")]]))).rejects.toThrow("no SKILL.md");
    await expect(library.add(new Map([["SKILL.md", strToU8("no front matter")]]))).rejects.toThrow("needs front matter");
    await expect(library.add(new Map([["SKILL.md", strToU8("---\nname: x\n---\nbody")]]))).rejects.toThrow("needs a description");
    await expect(library.add(new Map([["SKILL.md", skillMd("../escape")]]))).rejects.toThrow("not a usable skill name");
    await expect(library.add(new Map([["SKILL.md", skillMd("has space")]]))).rejects.toThrow("not a usable skill name");
    expect(await library.list()).toEqual([]);
  });

  it("refuses paths that leave the skill's folder, in a zip or a folder", async () => {
    const library = createLibrary(dir);
    for (const bad of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/evil.txt", "..\\evil.txt"]) {
      await expect(library.add(new Map([["SKILL.md", skillMd("tdd")], [bad, strToU8("x")]]))).rejects.toThrow("not a safe path");
    }
    await expect(library.addZip(zipOf({ "SKILL.md": skillMd("tdd"), "../evil.txt": strToU8("x") }))).rejects.toThrow("not a safe path");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("refuses too many files, a file or a total that is too big, even before inflating a zip, and a file that is not a zip", async () => {
    const library = createLibrary(dir);
    const many = new Map<string, Uint8Array>([["SKILL.md", skillMd("tdd")]]);
    for (let i = 0; i < MAX_FILES + 1; i++) {
      many.set(`f${String(i)}.txt`, strToU8("x"));
    }
    await expect(library.add(many)).rejects.toThrow("up to 100 files");
    await expect(library.add(new Map([["SKILL.md", skillMd("tdd")], ["big.bin", new Uint8Array(1024 * 1024 + 1)]]))).rejects.toThrow("larger than 1 MB");
    await expect(library.add(new Map([["SKILL.md", skillMd("tdd")], ...Array.from({ length: 6 }, (_, i) => {
      return [`b${String(i)}.bin`, new Uint8Array(1000 * 1000)] as const;
    })]))).rejects.toThrow("up to 5 MB in all");

    // A zip that claims a huge file is refused from the sizes it declares, without inflating it.
    const bomb = zipOf({ "SKILL.md": skillMd("tdd"), "zeros.bin": new Uint8Array(2 * 1024 * 1024) });
    expect(() => {
      return filesFromZip(bomb);
    }).toThrow(LibraryError);
    await expect(library.addZip(strToU8("this is not a zip"))).rejects.toThrow("not a readable zip");
  });

  it("exports a skill as a zip with its folder at the top, which can be added again", async () => {
    const library = createLibrary(dir);
    await library.add(new Map([["SKILL.md", skillMd("tdd")], ["notes/ref.md", strToU8("reference")]]));
    const zip = await library.exportZip("tdd");
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(["tdd/SKILL.md", "tdd/notes/ref.md"]);

    const other = createLibrary(path.join(dir, "other"));
    expect(await other.addZip(zip)).toMatchObject({ name: "tdd", files: 2 });
    await expect(library.exportZip("nope")).rejects.toThrow("no skill named");
  });

  it("removes a skill", async () => {
    const library = createLibrary(dir);
    await library.add(new Map([["SKILL.md", skillMd("tdd")]]));
    expect(await library.remove("tdd")).toBe(true);
    expect(await library.remove("tdd")).toBe(false);
    expect(await library.list()).toEqual([]);
  });

  it("gives a skill's instructions with the arguments, or a file from inside its own folder and nothing else", async () => {
    const library = createLibrary(dir);
    await library.add(new Map([["SKILL.md", skillMd("tdd")], ["REFERENCE.md", strToU8("reference text")]]));
    await fs.writeFile(path.join(dir, "outside.txt"), "outside");
    expect(await library.text("tdd", { arguments: "the parser" })).toContain("Write the test. the parser");
    expect(await library.text("tdd", { file: "REFERENCE.md" })).toBe("reference text");
    await expect(library.text("tdd", { file: "../outside.txt" })).rejects.toThrow("not inside the folder");
    await expect(library.text("nope", {})).rejects.toThrow("no skill named");
  });
});

describe("the library and who may start a skill", () => {
  it("keeps a skill only the person starts from the model, and gives it to the person", async () => {
    const library = createLibrary(dir);
    await library.add(new Map([["SKILL.md", skillMd("quiet", "Only you.", "Do it.", "disable-model-invocation: true\n")]]));
    await expect(library.text("quiet", {})).rejects.toThrow("started by the person");
    expect(await library.text("quiet", {}, { byPerson: true })).toContain("Do it.");
    expect((await library.list())[0]?.modelInvocable).toBe(false);
  });
});
