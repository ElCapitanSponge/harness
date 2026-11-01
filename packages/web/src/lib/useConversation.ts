import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Store } from "@tanstack/store";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";
import { ApiError, api, authHeaders, keyStore, readEvents } from "./api";
import type { Effort } from "@harness/core/effort";
import { applyEvent, emptyConversation, markBusy, type ConversationState, type StreamEvent } from "./conversation";

const pause = (ms: number, signal: AbortSignal): Promise<void> => {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
};

// Follows a conversation's events, resuming from where it left off when the connection drops.
const follow = async (id: string, store: Store<ConversationState>, signal: AbortSignal, client: QueryClient): Promise<void> => {
  while (!signal.aborted) {
    try {
      const res = await fetch(`/sessions/${id}/events?from=${String(store.state.cursor)}`, { headers: authHeaders(), signal });
      if (res.status === 404) {
        store.setState((s) => {
          return applyEvent(s, { type: "error", message: "This conversation no longer exists." });
        });
        return;
      }
      if (!res.ok) {
        throw new ApiError(res.status, "could not follow");
      }
      await readEvents(res, (payload) => {
        let event: StreamEvent;
        try {
          event = JSON.parse(payload) as StreamEvent;
        } catch {
          return;
        }
        store.setState((s) => {
          return applyEvent(s, event);
        });
        if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
          void client.invalidateQueries({ queryKey: ["sessions"] });
          void client.invalidateQueries({ queryKey: ["usage"] });
        }
      });
    } catch {
      // A dropped connection is retried below; an abort ends the loop.
    }
    await pause(1500, signal);
  }
};

// A conversation's live state: what to show, and whether a turn is running.
export const useConversation = (id: string) => {
  const client = useQueryClient();
  const key = useSelector(keyStore);
  const [store] = useState(() => {
    return new Store<ConversationState>(emptyConversation());
  });

  useEffect(() => {
    const abort = new AbortController();
    void follow(id, store, abort.signal, client);
    return () => {
      abort.abort();
    };
  }, [id, key, store, client]);

  const state = useSelector(store);

  const send = async (text: string, model?: string, effort?: Effort | "default", skill?: { name: string; arguments: string }): Promise<void> => {
    // Busy at once, so the button changes before the first event comes back.
    store.setState((s) => {
      return markBusy(s);
    });
    try {
      await api<unknown>(`/sessions/${id}/messages`, { method: "POST", body: { text, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(skill ? { skill } : {}) } });
    } catch (err) {
      store.setState((s) => {
        return applyEvent(s, { type: "error", message: err instanceof Error ? err.message : "Could not send." });
      });
    }
  };

  const cancel = async (): Promise<void> => {
    await api<unknown>(`/sessions/${id}/cancel`, { method: "POST", body: {} }).catch(() => {
      return undefined;
    });
  };

  const answer = async (approvalId: string, approve: boolean, always: boolean): Promise<void> => {
    await api<unknown>(`/sessions/${id}/approvals/${approvalId}`, { method: "POST", body: { approve, always } }).catch(() => {
      return undefined;
    });
  };

  return { state, send, cancel, answer };
};
