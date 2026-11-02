import type { SessionInfo } from "./types";

// What a conversation in the sidebar is doing, for the person: stopped for them (an approval or a question), working, or holding
// something they have not read. Waiting comes first, because that is the one that needs them.
export type Status = "needs-you" | "working" | "unread";

export const statusOf = (info: SessionInfo, viewing: boolean): Status | undefined => {
  if (info.waiting !== undefined) {
    return "needs-you";
  }
  if (info.busy) {
    return "working";
  }
  // The conversation open in front of the person is being read as it arrives.
  return !viewing && (info.read ?? info.events) < info.events ? "unread" : undefined;
};

export const statusLabel = (status: Status, info: SessionInfo): string => {
  switch (status) {
    case "needs-you":
      return info.waiting === "question" ? "Waiting for your answer" : "Waiting for your approval";
    case "working":
      return "Working";
    case "unread":
      return "Has new messages";
  }
};
