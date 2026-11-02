import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@/lib/types";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const send = vi.fn();
vi.mock("@/lib/useConversation", () => {
  return { useConversation: () => {
    return { state: { items: [], changes: [], plan: [], shots: [], busy: false, cursor: 0, next: 1 }, send, cancel: vi.fn(), answer: vi.fn(), reply: vi.fn() };
  } };
});

const { ConversationView } = await import("./ConversationView");
const { INIT_PROMPT } = await import("@/lib/commands");

const code: SessionInfo = { id: "s1", model: "qwen3-coder", device: "pc", root: "proj", busy: false, events: 0, created: 0, updated: 0, kind: "code", title: "Work", deviceConnected: true, mode: "ask" };
const chat: SessionInfo = { ...code, kind: "chat", device: "", root: "" };

// Matches an element whose text contains these words.
const hasText = (words: string) => {
  return (content: string): boolean => {
    return content.includes(words);
  };
};

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
};

const show = (info: SessionInfo) => {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/sessions") {
      return Promise.resolve([info]);
    }
    if (path === "/catalogue") {
      return Promise.resolve({ models: [{ id: "qwen3-coder", device: "pc", state: "loaded" }, { id: "qwen3-8b", device: "pc", state: "loaded" }, { id: "gemma-3", device: "pc", state: "loaded" }], claude: { available: false, models: [] } });
    }
    if (path === "/sessions/s1/compact") {
      return Promise.resolve({ ok: true, messages: 12, tokensBefore: 45000, tokensAfter: 8000 });
    }
    if (path === "/sessions/s1/mode" && init?.method === "PUT") {
      return Promise.resolve({ ...info, mode: "plan" });
    }
    return Promise.resolve([]);
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/c/s1"]}>
        <Routes>
          <Route path="/c/:id" element={<ConversationView />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const run = async (text: string) => {
  const box = await screen.findByLabelText("Message");
  await waitFor(() => {
    expect(box).toBeEnabled();
  });
  await userEvent.type(box, `${text}{Enter}`);
};

describe("built-in commands in a conversation", () => {
  beforeEach(() => {
    api.mockReset();
    send.mockReset();
    localStorage.clear();
  });

  it("/compact compacts the conversation and says what it did", async () => {
    show(code);
    await run("/compact");
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/sessions/s1/compact", { method: "POST", body: {} });
    });
    expect(await screen.findByText(hasText("Compacted 12 messages: about 45k tokens down to 8.0k."))).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/sessions/s1/compact", { method: "POST", body: {} });
    expect(send).not.toHaveBeenCalled();
  });

  it("/clear starts a fresh conversation in the same project and model", async () => {
    show(code);
    await run("/clear");
    expect(await screen.findByTestId("where")).toHaveTextContent("/?device=pc&root=proj&model=qwen3-coder");
  });

  it("/model with a name changes the model for the next message, and says when none fits or several do", async () => {
    show(code);
    await run("/model gemma");
    expect(await screen.findByText(hasText("The next message goes to gemma-3."))).toBeInTheDocument();
    await run("/model nothing");
    await waitFor(() => {
      expect(screen.getByText(hasText("No model matches \"nothing\"."))).toBeInTheDocument();
    });
    await run("/model qwen3");
    await waitFor(() => {
      expect(screen.getByText(hasText("fits 2 models"))).toBeInTheDocument();
    });
  });

  it("/permissions sets the mode, and names the choices when it is not given one", async () => {
    show(code);
    await run("/permissions plan");
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/sessions/s1/mode", { method: "PUT", body: { mode: "plan" } });
    });
    expect(await screen.findByText(hasText("Changes are now treated as: plan."))).toBeInTheDocument();
    await run("/permissions");
    await waitFor(() => {
      expect(screen.getByText(hasText("Use /permissions ask, edits, plan or bypass."))).toBeInTheDocument();
    });
  });

  it("/init has the model draft an AGENTS.md and ask before writing it", async () => {
    show(code);
    await run("/init");
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(INIT_PROMPT, undefined, undefined);
    });
    expect(await screen.findByText(hasText("ask before writing"))).toBeInTheDocument();
  });

  it("says why /init and /permissions do not apply in a chat, and sends nothing", async () => {
    show(chat);
    await run("/init");
    expect(await screen.findByText(hasText("/init needs a coding session"))).toBeInTheDocument();
    await run("/permissions plan");
    await waitFor(() => {
      expect(screen.getByText(hasText("/permissions applies to coding sessions"))).toBeInTheDocument();
    });
    expect(send).not.toHaveBeenCalled();
  });
});
