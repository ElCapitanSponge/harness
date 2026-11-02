import { useEffect, useRef, useState } from "react";
import { deviceTool, plainText } from "./devicefiles";
import { MAX_CONTEXT_FILE_BYTES } from "./pickfiles";
import { mentionAt, rank, splitQuery, type Candidate, type Mention } from "./mentions";

export interface Project {
  device: string;
  root: string;
}

// The files that fit the @word at the caret, listed from the project folder on its device a folder at a time (kept, so typing on in the
// same folder does not ask again). Nothing is offered when there is no project, or the word is not a path inside it.
export const useMention = (project: Project | undefined, text: string, caret: number, enabled: boolean): { mention: Mention | undefined; candidates: Candidate[]; problem: string } => {
  const mention = project && enabled ? mentionAt(text, caret) : undefined;
  const split = mention ? splitQuery(mention.query) : undefined;
  const dir = split?.dir;
  const [listings, setListings] = useState<Record<string, string[]>>({});
  const [problem, setProblem] = useState("");
  const asked = useRef(new Set<string>());
  const where = project ? `${project.device}\u0000${project.root}` : "";

  useEffect(() => {
    if (!project || dir === undefined || asked.current.has(`${where}\u0000${dir}`)) {
      return;
    }
    asked.current.add(`${where}\u0000${dir}`);
    void deviceTool(project.device, project.root, "list_dir", { path: dir === "" ? "." : dir }).then((output) => {
      setProblem("");
      setListings((current) => {
        return { ...current, [`${where}\u0000${dir}`]: output === "(empty)" ? [] : output.split("\n") };
      });
    }).catch((err: unknown) => {
      // Looked at again next time the word changes folder; a folder that cannot be listed simply offers nothing.
      asked.current.delete(`${where}\u0000${dir}`);
      setProblem(err instanceof Error ? err.message : "Could not list that folder.");
    });
  }, [project, where, dir]);

  const entries = dir === undefined ? undefined : listings[`${where}\u0000${dir}`];
  return { mention, candidates: split && entries ? rank(split.dir, entries, split.prefix) : [], problem };
};

export type FileContext = { ok: true; path: string; text: string; shortened: boolean } | { ok: false; problem: string };

// The text of a project file to put in the message as context: read through the device, text only, and small enough for a message.
export const readProjectFile = async (project: Project, path: string): Promise<FileContext> => {
  try {
    const { text, shortened } = plainText(await deviceTool(project.device, project.root, "read_file", { path }));
    if (text.includes("\u0000")) {
      return { ok: false, problem: `${path} looks like a binary file, not text.` };
    }
    if (text.length > MAX_CONTEXT_FILE_BYTES) {
      return { ok: false, problem: `${path} is larger than ${String(MAX_CONTEXT_FILE_BYTES / 1000)} KB, too big to add to a message.` };
    }
    return { ok: true, path, text, shortened };
  } catch (err) {
    return { ok: false, problem: `Could not read ${path}: ${err instanceof Error ? err.message : "unknown error"}` };
  }
};
