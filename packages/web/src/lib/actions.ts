// A run of the model's tool activity between two messages, folded into one group. Kept free of React so it can be tested.

export interface ActionEntry {
  // The one-line description of the call, such as "read a.txt".
  summary: string;
  // The tool's name. Absent in conversations stored before it was recorded; such an entry counts as "other".
  name?: string;
  // What the tool returned (shortened), once it has run. Absent while it runs, and when the person declined it.
  output?: string;
  failed?: boolean;
  // The file this call changed, with the diff of that change, the same one the side panel shows.
  change?: { path: string; patch?: string; note?: string; created: boolean };
}

export type ActionKind = "read" | "search" | "command" | "modified" | "other";

const READS = new Set(["read_file", "list_dir"]);
const SEARCHES = new Set(["grep"]);
const COMMANDS = new Set(["run_command", "git_read", "git_write", "gh_read", "gh_write", "task_output", "task_stop"]);

export const kindOf = (entry: ActionEntry): ActionKind => {
  if (entry.change !== undefined) {
    return "modified";
  }
  if (entry.name === undefined) {
    return "other";
  }
  if (READS.has(entry.name)) {
    return "read";
  }
  if (SEARCHES.has(entry.name)) {
    return "search";
  }
  return COMMANDS.has(entry.name) ? "command" : "other";
};

const plural = (n: number, one: string, many: string): string => {
  return `${String(n)} ${n === 1 ? one : many}`;
};

// "Read 4 files, ran 2 commands, modified 1 file", with a count of the ones that failed. Files modified are counted once each.
export const summariseActions = (entries: ActionEntry[]): string => {
  const count = (kind: ActionKind): number => {
    return entries.filter((e) => {
      return kindOf(e) === kind;
    }).length;
  };
  const files = new Set(entries.flatMap((e) => {
    return e.change ? [e.change.path] : [];
  }));
  const parts = [
    count("read") > 0 ? `read ${plural(count("read"), "file", "files")}` : "",
    count("search") > 0 ? `searched ${plural(count("search"), "time", "times")}` : "",
    count("command") > 0 ? `ran ${plural(count("command"), "command", "commands")}` : "",
    files.size > 0 ? `modified ${plural(files.size, "file", "files")}` : "",
    count("other") > 0 ? plural(count("other"), "other action", "other actions") : "",
  ].filter((p) => {
    return p !== "";
  });
  const failed = entries.filter((e) => {
    return e.failed === true;
  }).length;
  const text = parts.join(", ");
  const head = text === "" ? "Actions" : text.charAt(0).toUpperCase() + text.slice(1);
  return failed > 0 ? `${head}, ${String(failed)} failed` : head;
};
