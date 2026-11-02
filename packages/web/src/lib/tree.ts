import type { SessionInfo } from "./types";

// The conversation list with each sub-agent's conversation under the one that started it, one step further in. The order the list
// came in (most recent first) is kept among conversations at the same level. A sub-agent whose parent is gone is listed on its own.
export const nested = (list: SessionInfo[]): { info: SessionInfo; indent: number }[] => {
  const ids = new Set(list.map((s) => {
    return s.id;
  }));
  const out: { info: SessionInfo; indent: number }[] = [];
  const add = (info: SessionInfo, indent: number): void => {
    out.push({ info, indent });
    for (const child of list.filter((s) => {
      return s.parent === info.id;
    })) {
      add(child, indent + 1);
    }
  };
  for (const s of list) {
    if (!s.parent || !ids.has(s.parent)) {
      add(s, 0);
    }
  }
  return out;
};
