import type { SessionInfo } from "./types";

// Conversations stopped for an answer from the person, wherever they are looking. The sidebar marks each; this is what tells the person
// when they are looking at another conversation or at another tab.

export const needingYou = (list: SessionInfo[]): SessionInfo[] => {
  return list.filter((s) => {
    return s.waiting !== undefined;
  });
};

// Those that were not waiting last time we looked, so each is announced once as it starts to need the person.
export const newlyNeeding = (before: ReadonlySet<string>, now: SessionInfo[]): SessionInfo[] => {
  return needingYou(now).filter((s) => {
    return !before.has(s.id);
  });
};

export const titleFor = (count: number): string => {
  return count > 0 ? `(${String(count)}) Torii` : "Torii";
};

// The words of a notification for one conversation.
export const notificationFor = (s: SessionInfo): { title: string; body: string; tag: string } => {
  return {
    title: s.waiting === "question" ? "Torii: a question for you" : "Torii: approval needed",
    body: s.title || "A conversation needs you",
    tag: `needs-you-${s.id}`,
  };
};

// The tab's icon with a dot on it, from the plain one, as a data address.
export const iconWithDot = (icon: string): string => {
  const marker = "data:image/svg+xml,";
  if (!icon.startsWith(marker)) {
    return icon;
  }
  const svg = decodeURIComponent(icon.slice(marker.length)).replace("</svg>", "<circle cx='24' cy='8' r='7' fill='%23f59e0b' stroke='white' stroke-width='2'/></svg>");
  return `${marker}${encodeURIComponent(svg)}`;
};
