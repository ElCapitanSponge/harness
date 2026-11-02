import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { desktopApi } from "./desktop";
import { iconWithDot, needingYou, newlyNeeding, notificationFor, titleFor } from "./needsyou";
import { useSessions } from "./queries";

// Whatever the person is looking at, they are told when any conversation needs them: the count in the tab title, a dot on the tab icon,
// a notification when one starts to need them and they are not looking at it, and in the desktop app a badge on its icon. Clicking a
// notification opens that conversation.
export const useNeedsYou = (): void => {
  const sessions = useSessions();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const count = needingYou(sessions.data ?? []).length;
  const known = useRef<Set<string> | undefined>(undefined);
  const plainIcon = useRef<string | undefined>(undefined);

  useEffect(() => {
    document.title = titleFor(count);
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (link) {
      plainIcon.current ??= link.href;
      link.href = count > 0 ? iconWithDot(plainIcon.current) : plainIcon.current;
    }
    void desktopApi()?.setNeedsYou?.(count);
  }, [count]);

  useEffect(() => {
    if (sessions.data === undefined) {
      return;
    }
    const before = known.current;
    known.current = new Set(needingYou(sessions.data).map((s) => {
      return s.id;
    }));
    // The first look only learns what already waits; it is not news.
    if (before === undefined || typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }
    for (const s of newlyNeeding(before, sessions.data)) {
      // The conversation that is open follows its own events and notifies the moment it needs the person (see useNotifications).
      if (pathname === `/c/${s.id}`) {
        continue;
      }
      const words = notificationFor(s);
      try {
        const shown = new Notification(words.title, { body: words.body.slice(0, 200), tag: words.tag });
        shown.onclick = () => {
          void desktopApi()?.focus?.();
          window.focus();
          void navigate(`/c/${s.id}`);
          shown.close();
        };
      } catch {
        // Some browsers refuse a notification made this way; the tab title and the sidebar still show it.
      }
    }
  }, [sessions.data, pathname, navigate]);
};
