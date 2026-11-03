import { baseName } from "./desktop";
import { nested } from "./tree";
import type { SessionInfo } from "./types";

// The sidebar's conversations gathered by project: a folder on a device. Chats have no project and are gathered in one group of their own.
// Within a group the order is the one the list came in (most recent first), with each sub-agent's conversation under its parent.

export interface Group {
  // A project (a folder on a device), the conversations pinned to the top, the chats that have no project, or the conversations put away in the Archive.
  kind: "pinned" | "project" | "chats" | "archive";
  // groupKey of the device and root; chats have neither, so theirs is groupKey("", ""), as the collapsed list stores it.
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

// The Archive section is closed unless this entry is in the stored list of collapsed groups. That is the reverse of a project, which is open
// unless it is stored, so what gets remembered is the person opening it. The device name cannot be a real one.
export const ARCHIVE_ENTRY = { device: "@archive", root: "" };

export const groupSessions = (list: SessionInfo[], thisDevice: string | undefined): Group[] => {
  const projects = new Map<string, SessionInfo[]>();
  const chats: SessionInfo[] = [];
  const archived = list.filter((s) => {
    return s.archived === true;
  }).sort((a, b) => {
    return b.updated - a.updated;
  });
  const pinned = list.filter((s) => {
    return s.pinned === true && s.archived !== true;
  }).sort((a, b) => {
    return b.updated - a.updated;
  });
  for (const s of list) {
    if (s.pinned === true || s.archived === true) {
      continue;
    }
    if (s.kind !== "code") {
      chats.push(s);
      continue;
    }
    const key = groupKey(s.device, s.root);
    projects.set(key, [...(projects.get(key) ?? []), s]);
  }
  const out: Group[] = pinned.length > 0 ? [{ kind: "pinned", key: "pinned", device: "", root: "", name: "Pinned", here: false, items: nested(pinned) }] : [];
  out.push(...[...projects.entries()].map(([key, items]) => {
    const first = items[0];
    return {
      kind: "project" as const,
      key,
      device: first?.device ?? "",
      root: first?.root ?? "",
      name: baseName(first?.root ?? ""),
      here: thisDevice !== undefined && first?.device === thisDevice,
      items: nested(items),
    };
  }));
  if (chats.length > 0) {
    out.push({ kind: "chats", key: groupKey("", ""), device: "", root: "", name: "Chats", here: false, items: nested(chats) });
  }
  if (archived.length > 0) {
    out.push({ kind: "archive", key: groupKey(ARCHIVE_ENTRY.device, ARCHIVE_ENTRY.root), device: ARCHIVE_ENTRY.device, root: ARCHIVE_ENTRY.root, name: "Archive", here: false, items: nested(archived) });
  }
  return out;
};
