import type { FileChange } from "@harness/core";

// A line diff for the side panel: what a write or edit changed, shown to the person and never sent to the model. Small and
// self-contained so it can be tested; a file too big to diff cheaply is summarised instead.

const MAX_LINES = 5000;
const MAX_CELLS = 4_000_000;
const MAX_PATCH_CHARS = 60_000;
const CONTEXT = 3;

interface Op { kind: " " | "+" | "-"; text: string }

const lines = (text: string): string[] => {
  if (text === "") {
    return [];
  }
  const parts = text.split("\n");
  // A final newline is not an extra empty line.
  if (parts.at(-1) === "") {
    parts.pop();
  }
  return parts;
};

// The edit script between two lists of lines: shared start and end are trimmed, and the middle is matched with a longest common
// subsequence table. A middle too big for the table is shown as removed then added.
const script = (a: string[], b: string[]): Op[] => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map((text) => {
    return { kind: " ", text };
  });
  const tail: Op[] = a.slice(endA).map((text) => {
    return { kind: " ", text };
  });
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const middle: Op[] = [];
  if (x.length * y.length > MAX_CELLS) {
    middle.push(...x.map((text): Op => {
      return { kind: "-", text };
    }), ...y.map((text): Op => {
      return { kind: "+", text };
    }));
  } else {
    // table[i][j] = length of the longest common subsequence of x[i..] and y[j..]
    const width = y.length + 1;
    const table = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        table[i * width + j] = x[i] === y[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        middle.push({ kind: " ", text: x[i] ?? "" });
        i++;
        j++;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
        middle.push({ kind: "-", text: x[i] ?? "" });
        i++;
      } else {
        middle.push({ kind: "+", text: y[j] ?? "" });
        j++;
      }
    }
    for (; i < x.length; i++) {
      middle.push({ kind: "-", text: x[i] ?? "" });
    }
    for (; j < y.length; j++) {
      middle.push({ kind: "+", text: y[j] ?? "" });
    }
  }
  return [...head, ...middle, ...tail];
};

// Unified-diff hunks (`@@ -a,b +c,d @@`) with a few lines of context around each change.
const hunks = (ops: Op[]): string => {
  const changed = ops.flatMap((op, i) => {
    return op.kind === " " ? [] : [i];
  });
  const out: string[] = [];
  let k = 0;
  while (k < changed.length) {
    let first = changed[k] ?? 0;
    let last = first;
    // Changes within twice the context of each other share a hunk.
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - last <= CONTEXT * 2 + 1) {
      k++;
      last = changed[k] ?? last;
    }
    k++;
    first = Math.max(0, first - CONTEXT);
    const end = Math.min(ops.length - 1, last + CONTEXT);
    const slice = ops.slice(first, end + 1);
    const before = ops.slice(0, first).filter((o) => {
      return o.kind !== "+";
    }).length;
    const after = ops.slice(0, first).filter((o) => {
      return o.kind !== "-";
    }).length;
    const oldCount = slice.filter((o) => {
      return o.kind !== "+";
    }).length;
    const newCount = slice.filter((o) => {
      return o.kind !== "-";
    }).length;
    out.push(`@@ -${String(oldCount === 0 ? before : before + 1)},${String(oldCount)} +${String(newCount === 0 ? after : after + 1)},${String(newCount)} @@`);
    out.push(...slice.map((o) => {
      return `${o.kind}${o.text}`;
    }));
  }
  return out.join("\n");
};

// What a write or edit changed in one file. `before` is undefined for a file that did not exist.
export const fileChange = (file: string, before: string | undefined, after: string): FileChange => {
  const created = before === undefined;
  if (after.includes("\u0000") || (before?.includes("\u0000") ?? false)) {
    return { path: file, created, added: 0, removed: 0, note: "binary file, not shown" };
  }
  const a = lines(before ?? "");
  const b = lines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { path: file, created, added: b.length, removed: a.length, note: "large file, not shown" };
  }
  const ops = script(a, b);
  const added = ops.filter((o) => {
    return o.kind === "+";
  }).length;
  const removed = ops.filter((o) => {
    return o.kind === "-";
  }).length;
  const patch = hunks(ops);
  if (patch.length > MAX_PATCH_CHARS) {
    return { path: file, created, added, removed, note: "large change, not shown" };
  }
  return { path: file, created, added, removed, ...(patch === "" ? {} : { patch }) };
};
