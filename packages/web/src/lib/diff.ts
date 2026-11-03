// Reads a unified diff into rows, each with the line numbers it has in the old file and the new one. The numbers come from the hunk
// headers (`@@ -a,b +c,d @@`), so they need nothing from the gateway or the agent. Kept free of React so it can be tested.

export interface DiffRow {
  kind: "hunk" | "add" | "del" | "context" | "meta";
  // The line as it is in the patch, with its leading + or -.
  text: string;
  // The line's number in the old file; a removed or unchanged line has one.
  old?: number;
  // The line's number in the new file; an added or unchanged line has one.
  new?: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export const parseDiff = (patch: string): DiffRow[] => {
  const lines = patch.split("\n");
  // A patch that ends in a newline would otherwise show an empty last row with a number.
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  let old = 0;
  let next = 0;
  let inHunk = false;
  return lines.map((line): DiffRow => {
    const hunk = HUNK.exec(line);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text: line };
    }
    // File headers before the first hunk, and "\ No newline at end of file", have no line of their own.
    if (!inHunk || line.startsWith("\\")) {
      return { kind: "meta", text: line };
    }
    if (line.startsWith("+")) {
      return { kind: "add", text: line, new: next++ };
    }
    if (line.startsWith("-")) {
      return { kind: "del", text: line, old: old++ };
    }
    return { kind: "context", text: line, old: old++, new: next++ };
  });
};
