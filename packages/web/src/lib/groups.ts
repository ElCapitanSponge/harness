import { baseName } from "./desktop";
import { nested } from "./tree";
import type { SessionInfo } from "./types";

// The sidebar's conversations gathered by project: a folder on a device. Chats have no project and are gathered in one group of their own.
// Within a group the order is the one the list came in (most recent first), with each sub-agent's conversation under its parent.

export interface Group {
  // "device\u0000root", or "" for chats.
  key: string;
  device: string;
  root: string;
  // The folder's name, or "Chats".
  name: string;
  // Whether the project is on the device this client is on. Never true for chats.
  here: boolean;
  items: { info: SessionInfo; indent: number }[];
}

export const groupKey = (device: string, root: string): string => {
  return `${device}\u0000${root}`;
};

export const groupSessions = (list: SessionInfo[], thisDevice: string | undefined): Group[] => {
  const projects = new Map<string, SessionInfo[]>();
  const chats: SessionInfo[] = [];
  for (const s of list) {
    if (s.kind !== "code") {
      chats.push(s);
      continue;
    }
    const key = groupKey(s.device, s.root);
    projects.set(key, [...(projects.get(key) ?? []), s]);
  }
  const out: Group[] = [...projects.entries()].map(([key, items]) => {
    const first = items[0];
    return {
      key,
      device: first?.device ?? "",
      root: first?.root ?? "",
      name: baseName(first?.root ?? ""),
      here: thisDevice !== undefined && first?.device === thisDevice,
      items: nested(items),
    };
  });
  if (chats.length > 0) {
    out.push({ key: "", device: "", root: "", name: "Chats", here: false, items: nested(chats) });
  }
  return out;
};
