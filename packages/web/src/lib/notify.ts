import { useEffect, useRef, useState } from "react";
import type { Item } from "./conversation";

// A notification when the model needs an answer (an approval or a question) and the page is in the background. The browser has to be
// allowed to show them, which the person is asked for once, by pressing the bell.

type Permission = NotificationPermission | "unsupported";

const current = (): Permission => {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
};

// What is waiting on the person, if anything: the text for a notification.
export const waitingFor = (items: Item[]): { key: string; title: string; body: string } | undefined => {
  const last = items.findLast((i) => {
    return (i.kind === "approval" || i.kind === "question") && i.status === "pending";
  });
  if (last?.kind === "approval") {
    return { key: `approval-${last.approvalId}`, title: last.tool === "plan" ? "Torii: approve the plan" : "Torii: approval needed", body: last.summary };
  }
  if (last?.kind === "question") {
    return { key: `question-${last.questionId}`, title: "Torii: a question for you", body: last.question };
  }
  return undefined;
};

export const useNotifications = (items: Item[]): { permission: Permission; ask: () => void } => {
  const [permission, setPermission] = useState<Permission>(current);
  const told = useRef(new Set<string>());
  const waiting = waitingFor(items);

  useEffect(() => {
    if (!waiting || permission !== "granted" || !document.hidden || told.current.has(waiting.key)) {
      return;
    }
    told.current.add(waiting.key);
    try {
      new Notification(waiting.title, { body: waiting.body.slice(0, 200), tag: waiting.key });
    } catch {
      // Some browsers refuse a notification made this way; the page still shows the card.
    }
  }, [waiting, permission]);

  return {
    permission,
    ask: () => {
      if (typeof Notification !== "undefined") {
        void Notification.requestPermission().then(setPermission);
      }
    },
  };
};
