import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
const events = vi.hoisted(() => {
  return { payloads: [] as string[] };
});
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    api: (path: string, init?: unknown) => {
      return api(path, init) as Promise<unknown>;
    },
    readEvents: (_res: Response, onData: (payload: string) => void) => {
      for (const payload of events.payloads) {
        onData(payload);
      }
      return new Promise<void>(() => {
        return undefined;
      });
    },
  };
});

const { useConversation } = await import("./useConversation");

const wrapper = ({ children }: { children: ReactNode }) => {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
};

const visibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => {
    return state;
  } });
};

describe("telling the gateway how much of a conversation has been read", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({});
    events.payloads = [JSON.stringify({ type: "user", text: "hi" }), JSON.stringify({ type: "done", stopped: false })];
    vi.stubGlobal("fetch", vi.fn(() => {
      return Promise.resolve(new Response("", { status: 200 }));
    }));
    visibility("visible");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the events seen while the page is in front of the person", async () => {
    renderHook(() => {
      return useConversation("s1");
    }, { wrapper });
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/sessions/s1/read", { method: "PUT", body: { events: 2 } });
    });
  });

  it("does not report events that arrive while the page is hidden", async () => {
    visibility("hidden");
    const { result } = renderHook(() => {
      return useConversation("s2");
    }, { wrapper });
    await waitFor(() => {
      expect(result.current.state.cursor).toBe(2);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 700);
    });
    expect(api).not.toHaveBeenCalledWith("/sessions/s2/read", expect.anything());
  });
});
