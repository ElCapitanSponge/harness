import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "./types";

const sessions = vi.hoisted(() => {
  return { list: [] as SessionInfo[] };
});
vi.mock("./queries", () => {
  return { useSessions: () => {
    return { data: sessions.list };
  } };
});

const { useNeedsYou } = await import("./useNeedsYou");

const info = (id: string, waiting?: "approval" | "question"): SessionInfo => {
  return { id, model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: `T ${id}`, deviceConnected: true, ...(waiting ? { waiting } : {}) };
};

// `tick` only makes a new element, so that drawing again reads the list as it is now.
const Probe = ({ tick }: { tick: number }) => {
  useNeedsYou();
  return <span hidden>{tick}</span>;
};

const show = (at = "/") => {
  const client = new QueryClient();
  let tick = 0;
  const view = () => {
    tick += 1;
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="*" element={<Probe tick={tick} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  const r = render(view());
  return { rerender: () => {
    r.rerender(view());
  } };
};

const shown: { title: string; options?: NotificationOptions }[] = [];

describe("telling the person which conversations need them", () => {
  beforeEach(() => {
    shown.length = 0;
    sessions.list = [];
    document.title = "Torii";
    document.head.innerHTML = "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\" />";
    class FakeNotification {
      static permission = "granted";
      onclick: (() => void) | undefined;
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, ...(options ? { options } : {}) });
      }

      close(): void {
        return undefined;
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the count in the tab title and a dot on the tab icon, and takes them off when nothing waits", async () => {
    sessions.list = [info("a", "approval"), info("b", "question"), info("c")];
    const view = show();
    await waitFor(() => {
      expect(document.title).toBe("(2) Torii");
    });
    expect(decodeURIComponent(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href ?? "")).toContain("<circle");
    sessions.list = [info("a"), info("b"), info("c")];
    view.rerender();
    await waitFor(() => {
      expect(document.title).toBe("Torii");
    });
    expect(decodeURIComponent(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href ?? "")).not.toContain("<circle");
  });

  it("notifies when another conversation starts to need the person, but not for what already waited", async () => {
    sessions.list = [info("a", "approval")];
    const view = show();
    await waitFor(() => {
      expect(document.title).toBe("(1) Torii");
    });
    expect(shown).toEqual([]);
    sessions.list = [info("a", "approval"), info("b", "question")];
    view.rerender();
    await waitFor(() => {
      expect(shown).toHaveLength(1);
    });
    expect(shown[0]).toMatchObject({ title: "Torii: a question for you", options: { body: "T b", tag: "needs-you-b" } });
  });

  it("leaves the open conversation to its own notification", async () => {
    const view = show("/c/b");
    sessions.list = [info("b", "approval")];
    view.rerender();
    await waitFor(() => {
      expect(document.title).toBe("(1) Torii");
    });
    expect(shown).toEqual([]);
  });

  it("does not notify when the browser has not been allowed to", async () => {
    (Notification as unknown as { permission: string }).permission = "default";
    const view = show();
    sessions.list = [info("a", "approval")];
    view.rerender();
    await waitFor(() => {
      expect(document.title).toBe("(1) Torii");
    });
    expect(shown).toEqual([]);
  });
});
