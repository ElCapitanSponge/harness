import fs from "node:fs/promises";
import path from "node:path";

// Files the person chooses with the operating system's file picker, read here (the page cannot read the file system) so their text can
// be added to a message as context. Only text, and only up to a size a model can reasonably be given.

export const MAX_CONTEXT_FILE_BYTES = 200_000;

export interface PickedFile {
  path: string;
  name: string;
  // The text, when the file could be read as text.
  content?: string;
  // Why it was not read, in words for the person.
  problem?: string;
}

export const readPicked = async (file: string): Promise<PickedFile> => {
  const name = path.basename(file);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
      return { path: file, name, problem: "That is not a file." };
    }
    if (stat.size > MAX_CONTEXT_FILE_BYTES) {
      return { path: file, name, problem: `${name} is larger than ${String(MAX_CONTEXT_FILE_BYTES / 1000)} KB, too big to add to a message. Put its folder in a project and let the model read it.` };
    }
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) {
      return { path: file, name, problem: `${name} looks like a binary file, not text.` };
    }
    return { path: file, name, content: buffer.toString("utf8") };
  } catch (err) {
    return { path: file, name, problem: `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}` };
  }
};
