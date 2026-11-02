import fs from "node:fs/promises";
import path from "node:path";
import { SKILL_NAME_RULE, discoverSkillsIn, loadSkill, parseFrontMatter, type SkillSummary } from "@harness/tools";
import { unzipSync, zipSync } from "fflate";

// The gateway's own library of skills, kept on its data volume in the same layout as a device's skills folder, so they are available
// in every conversation, including chats that have no device. Skills come in as a zip or as a set of files, and go out as a zip, so
// they move between Torii, Claude.ai and other tools. Everything that comes in is checked: names, paths, sizes and counts.

export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export interface LibrarySkill extends SkillSummary {
  // How many files the skill has, and how many bytes they come to.
  files: number;
  bytes: number;
}

export class LibraryError extends Error {}

// The library already has a skill by that name.
export class LibraryConflict extends LibraryError {}

// A path from a zip or a folder, made safe: forward slashes, no way out of the skill's folder, nothing hidden by the system.
const cleanPath = (raw: string): string | undefined => {
  const p = raw.replaceAll("\\", "/");
  if (p.endsWith("/") || p === "") {
    return undefined;
  }
  const parts = p.split("/").filter((s) => {
    return s !== "" && s !== ".";
  });
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || parts.includes("..") || p.includes("\u0000") || p.length > 200) {
    throw new LibraryError(`"${raw}" is not a safe path inside a skill`);
  }
  if (parts[0] === "__MACOSX" || parts.at(-1) === ".DS_Store") {
    return undefined;
  }
  return parts.join("/");
};

// The files of a skill, from whatever was given: if SKILL.md is not at the top, the single folder that holds it is the skill.
const normalize = (given: Map<string, Uint8Array>): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>();
  for (const [raw, data] of given) {
    const p = cleanPath(raw);
    if (p !== undefined) {
      files.set(p, data);
    }
  }
  if (files.size > MAX_FILES) {
    throw new LibraryError(`a skill may have up to ${String(MAX_FILES)} files; this has ${String(files.size)}`);
  }
  let total = 0;
  for (const [p, data] of files) {
    if (data.length > MAX_FILE_BYTES) {
      throw new LibraryError(`"${p}" is larger than ${String(MAX_FILE_BYTES / 1024 / 1024)} MB`);
    }
    total += data.length;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new LibraryError(`a skill may be up to ${String(MAX_TOTAL_BYTES / 1024 / 1024)} MB in all`);
  }
  if (files.has("SKILL.md")) {
    return files;
  }
  const tops = new Set([...files.keys()].map((p) => {
    return p.split("/")[0];
  }));
  const top = [...tops][0];
  if (tops.size === 1 && top !== undefined && files.has(`${top}/SKILL.md`)) {
    return new Map([...files].map(([p, data]) => {
      return [p.slice(top.length + 1), data] as const;
    }));
  }
  throw new LibraryError("there is no SKILL.md at the top of that skill (or in the one folder that holds it)");
};

// Opens a zip without trusting it: the sizes it claims are checked before anything is inflated.
export const filesFromZip = (bytes: Uint8Array): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>();
  let claimed = 0;
  let count = 0;
  try {
    const entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) {
          return false;
        }
        count++;
        claimed += file.originalSize;
        if (count > MAX_FILES * 2 || file.originalSize > MAX_FILE_BYTES || claimed > MAX_TOTAL_BYTES * 2) {
          throw new LibraryError("that zip is too big to be a skill");
        }
        return true;
      },
    });
    for (const [name, data] of Object.entries(entries)) {
      files.set(name, data);
    }
  } catch (err) {
    throw err instanceof LibraryError ? err : new LibraryError("that file is not a readable zip");
  }
  return files;
};

export const createLibrary = (dir: string) => {
  const folderOf = (name: string): string => {
    if (!SKILL_NAME_RULE.test(name)) {
      throw new LibraryError(`"${name}" is not a usable skill name (letters, digits, hyphens; up to 64)`);
    }
    return path.join(dir, name);
  };

  const sizeOf = async (folder: string): Promise<{ files: number; bytes: number }> => {
    let files = 0;
    let bytes = 0;
    const walk = async (d: string): Promise<void> => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          await walk(path.join(d, e.name));
        } else if (e.isFile()) {
          files++;
          bytes += (await fs.stat(path.join(d, e.name))).size;
        }
      }
    };
    await walk(folder).catch(() => {
      return undefined;
    });
    return { files, bytes };
  };

  const library = {
    async list(): Promise<LibrarySkill[]> {
      const { skills } = await discoverSkillsIn(dir, "library");
      return Promise.all(skills.map(async ({ folder, ...summary }) => {
        return { ...summary, ...(await sizeOf(folder)) };
      }));
    },

    async get(name: string): Promise<(SkillSummary & { folder: string }) | undefined> {
      const { skills } = await discoverSkillsIn(dir, "library");
      return skills.find((s) => {
        return s.name === name;
      });
    },

    // Saves a skill from its files. The name is the one in its front matter. A skill already in the library is only replaced on request.
    async add(given: Map<string, Uint8Array>, options: { overwrite?: boolean } = {}): Promise<LibrarySkill> {
      const files = normalize(given);
      const text = new TextDecoder().decode(files.get("SKILL.md"));
      const parsed = parseFrontMatter(text);
      const name = typeof parsed?.data.name === "string" ? parsed.data.name.trim() : "";
      const description = typeof parsed?.data.description === "string" ? parsed.data.description.trim() : "";
      if (!parsed || name === "") {
        throw new LibraryError("SKILL.md needs front matter (--- ... ---) with a name");
      }
      if (description === "") {
        throw new LibraryError("the front matter of SKILL.md needs a description");
      }
      const target = folderOf(name);
      const exists = await fs.stat(target).then(() => {
        return true;
      }, () => {
        return false;
      });
      if (exists && options.overwrite !== true) {
        throw new LibraryConflict(`the library already has a skill named "${name}"`);
      }
      // Written beside the final place and moved in, so a failure never leaves half a skill.
      const staging = `${target}.incoming-${String(Date.now())}`;
      await fs.rm(staging, { recursive: true, force: true });
      try {
        for (const [p, data] of files) {
          const out = path.join(staging, p);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, data);
        }
        await fs.rm(target, { recursive: true, force: true });
        await fs.rename(staging, target);
      } catch (err) {
        await fs.rm(staging, { recursive: true, force: true });
        throw err;
      }
      const found = (await library.list()).find((s) => {
        return s.name === name;
      });
      if (!found) {
        throw new LibraryError("that skill could not be read after it was saved");
      }
      return found;
    },

    addZip(bytes: Uint8Array, options: { overwrite?: boolean } = {}): Promise<LibrarySkill> {
      // A zip that cannot be opened is a rejected promise like any other refusal.
      return Promise.resolve().then(() => {
        return library.add(filesFromZip(bytes), options);
      });
    },

    // A skill as a zip with its folder at the top, the layout other tools take.
    async exportZip(name: string): Promise<Uint8Array> {
      const skill = await library.get(name);
      if (!skill) {
        throw new LibraryError(`there is no skill named "${name}" in the library`);
      }
      const entries: Record<string, Uint8Array> = {};
      const walk = async (d: string, prefix: string): Promise<void> => {
        for (const e of await fs.readdir(d, { withFileTypes: true })) {
          if (e.isDirectory()) {
            await walk(path.join(d, e.name), `${prefix}${e.name}/`);
          } else if (e.isFile()) {
            entries[`${prefix}${e.name}`] = new Uint8Array(await fs.readFile(path.join(d, e.name)));
          }
        }
      };
      await walk(skill.folder, `${name}/`);
      return zipSync(entries);
    },

    async remove(name: string): Promise<boolean> {
      const skill = await library.get(name);
      if (!skill) {
        return false;
      }
      await fs.rm(skill.folder, { recursive: true, force: true });
      return true;
    },

    // The skill's instructions with the arguments filled in, or with `file`, a file from inside its folder.
    async text(name: string, args: Record<string, unknown>, options: { byPerson?: boolean } = {}): Promise<string> {
      const skill = await library.get(name);
      if (!skill) {
        throw new Error(`there is no skill named "${name}"`);
      }
      // A skill that only the person starts is not the model's to load.
      if (!skill.modelInvocable && options.byPerson !== true) {
        throw new Error(`the skill "${name}" is started by the person, not by you`);
      }
      return loadSkill(skill, args);
    },
  };
  return library;
};

export type Library = ReturnType<typeof createLibrary>;
