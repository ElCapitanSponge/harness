import type { NodeRecord } from "./types";

// Which device the browser is on. The gateway says which agent connects from the browser's own address; if it cannot tell (a
// container hides the browser's address), the person says once and the page remembers. "none" means there is no agent here.

export const THIS_DEVICE_KEY = "torii-this-device";
export const RECENT_KEY = "torii-recent-folders";

export const readStored = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

export const writeStored = (key: string, value: string | undefined): void => {
  try {
    if (value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Remembering is a convenience.
  }
};

export type ThisDevice = { state: "device"; nodeId: string } | { state: "none" } | { state: "unknown" };

// The person's choice wins, then the gateway's match. A device that is no longer connected is not "here".
export const resolveThisDevice = (matched: string[], choice: string | undefined, nodes: NodeRecord[]): ThisDevice => {
  if (choice === "none") {
    return { state: "none" };
  }
  const connected = (id: string | undefined): id is string => {
    return id !== undefined && nodes.some((n) => {
      return n.nodeId === id;
    });
  };
  if (connected(choice)) {
    return { state: "device", nodeId: choice };
  }
  const match = matched.find(connected);
  return match === undefined ? { state: "unknown" } : { state: "device", nodeId: match };
};

// The setup guide for the operating system the browser is on.
export const guideFor = (userAgent: string): { os: string; href: string } => {
  const base = "https://github.com/ElCapitanSponge/harness/blob/main/docs/guides/";
  if (/Windows/i.test(userAgent)) {
    return { os: "Windows", href: `${base}windows.md` };
  }
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    return { os: "macOS", href: `${base}macos.md` };
  }
  return { os: "Linux", href: `${base}linux.md` };
};

export interface RecentFolder {
  device: string;
  root: string;
}

export const readRecent = (): RecentFolder[] => {
  try {
    const parsed: unknown = JSON.parse(readStored(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is RecentFolder => {
      return typeof r === "object" && r !== null && typeof (r as RecentFolder).device === "string" && typeof (r as RecentFolder).root === "string";
    }).slice(0, 5) : [];
  } catch {
    return [];
  }
};

// The folder just used goes to the front; the list keeps the last five.
export const pushRecent = (folder: RecentFolder): RecentFolder[] => {
  const next = [folder, ...readRecent().filter((r) => {
    return r.device !== folder.device || r.root !== folder.root;
  })].slice(0, 5);
  writeStored(RECENT_KEY, JSON.stringify(next));
  return next;
};
