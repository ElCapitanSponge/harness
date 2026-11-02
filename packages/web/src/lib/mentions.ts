// Typing @ in a coding session's message box searches the project's files. These are the parts that do not need the page: finding the
// word being typed, working out which folder to list for it, ranking what comes back, and putting the choice into the message.

export interface Mention {
  // Where the @ is in the text, and where the caret is (the end of the word).
  start: number;
  end: number;
  // What has been typed after the @.
  query: string;
}

// The @word the caret is at the end of, if there is one. The @ has to start the message or follow white space, so an address such as
// me@example.com is left alone.
export const mentionAt = (text: string, caret: number): Mention | undefined => {
  const before = text.slice(0, caret);
  const found = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!found) {
    return undefined;
  }
  const query = found[2] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
};

// The folder to list and the part of a name typed so far: "src/comp" lists "src" and looks for names that fit "comp". Anything that
// climbs out of the project folder, or is not a path inside it, has no folder to list.
export const splitQuery = (query: string): { dir: string; prefix: string } | undefined => {
  const slashed = query.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    return undefined;
  }
  const cut = slashed.lastIndexOf("/");
  const dir = cut < 0 ? "" : slashed.slice(0, cut);
  if (dir.split("/").some((part) => {
    return part === "..";
  })) {
    return undefined;
  }
  return { dir, prefix: cut < 0 ? slashed : slashed.slice(cut + 1) };
};

export interface Candidate {
  // The path from the project folder, with a trailing slash for a folder.
  path: string;
  name: string;
  isDir: boolean;
}

const LIMIT = 8;

// The names in a folder that fit what was typed: those that start with it first, then those that contain it, folders before files. Hidden
// names are offered only when the typed part starts with a dot.
export const rank = (dir: string, entries: string[], prefix: string): Candidate[] => {
  const wanted = prefix.toLowerCase();
  const all = entries.filter((e) => {
    return e !== "" && !e.startsWith("[...");
  }).map((entry) => {
    const isDir = entry.endsWith("/");
    const name = isDir ? entry.slice(0, -1) : entry;
    return { path: `${dir === "" ? "" : `${dir}/`}${name}${isDir ? "/" : ""}`, name, isDir };
  }).filter((c) => {
    return (!c.name.startsWith(".") || wanted.startsWith(".")) && c.name.toLowerCase().includes(wanted);
  });
  const score = (c: Candidate): number => {
    return (c.name.toLowerCase().startsWith(wanted) ? 0 : 2) + (c.isDir ? 0 : 1);
  };
  return all.sort((a, b) => {
    return score(a) - score(b) || a.name.localeCompare(b.name);
  }).slice(0, LIMIT);
};

// The message with the @word replaced by the chosen path. A file ends the word with a space; a folder does not, so the person can go on
// typing inside it.
export const applyMention = (text: string, mention: Mention, choice: Candidate): { text: string; caret: number } => {
  const insert = `@${choice.path}${choice.isDir ? "" : " "}`;
  return { text: text.slice(0, mention.start) + insert + text.slice(mention.end), caret: mention.start + insert.length };
};
