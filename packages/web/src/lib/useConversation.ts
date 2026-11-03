import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Store } from "@tanstack/store";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";
import { ApiError, api, authHeaders, keyStore, readEvents } from "./api";
import type { Effort } from "@harness/core/effort";
import type { ImageAttachment } from "@harness/core/image";
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
      // The gateway tells a client that joins what is waiting, but only when something is; what this client remembers from before is stale.
      store.setState((s) => {
        return applyEvent(s, { type: "queue", messages: [], held: false });
      });
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

  // Tell the gateway how much of this conversation has been seen, so the sidebar of every client clears it. Only while the page is
  // in front of the person: a reply that arrives in a background tab has not been read.
  const seen = state.cursor;
  useEffect(() => {
    if (seen === 0) {
      return undefined;
    }
    const report = (): void => {
      if (document.visibilityState === "visible") {
        void api<unknown>(`/sessions/${id}/read`, { method: "PUT", body: { events: seen } }).then(() => {
          return client.invalidateQueries({ queryKey: ["sessions"] });
        }).catch(() => {
          return undefined;
        });
      }
    };
    const timer = setTimeout(report, 400);
    document.addEventListener("visibilitychange", report);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", report);
    };
  }, [id, seen, client]);

  const send = async (text: string, model?: string, effort?: Effort | "default", skill?: { name: string; arguments: string }, images?: ImageAttachment[]): Promise<void> => {
    // Busy at once, so the button changes before the first event comes back.
    store.setState((s) => {
      return markBusy(s);
    });
    try {
      await api<unknown>(`/sessions/${id}/messages`, { method: "POST", body: { text, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(skill ? { skill } : {}), ...(images ? { images } : {}) } });
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

  const answer = async (approvalId: string, approve: boolean, always: boolean | "project", reason?: string): Promise<void> => {
    await api<unknown>(`/sessions/${id}/approvals/${approvalId}`, { method: "POST", body: { approve, always, ...(reason ? { reason } : {}) } }).catch(() => {
      return undefined;
    });
  };

  const reply = async (questionId: string, text: string): Promise<void> => {
    await api<unknown>(`/sessions/${id}/questions/${questionId}`, { method: "POST", body: { answer: text } }).catch(() => {
      return undefined;
    });
  };

  // The queue is the gateway's; these ask it, and the change comes back as a queue event. A message that was taken up meanwhile is gone, which is fine.
  const editQueued = async (queueId: string, text: string): Promise<void> => {
    await api<unknown>(`/sessions/${id}/queue/${queueId}`, { method: "PATCH", body: { text } }).catch(() => {
      return undefined;
    });
  };

  const removeQueued = async (queueId: string): Promise<void> => {
    await api<unknown>(`/sessions/${id}/queue/${queueId}`, { method: "DELETE" }).catch(() => {
      return undefined;
    });
  };

  const sendQueuedNow = async (queueId: string): Promise<void> => {
    try {
      await api<unknown>(`/sessions/${id}/queue/${queueId}/send`, { method: "POST", body: {} });
    } catch (err) {
      store.setState((s) => {
        return applyEvent(s, { type: "error", message: err instanceof Error ? err.message : "Could not send." });
      });
    }
  };

  return { state, send, cancel, answer, reply, editQueued, removeQueued, sendQueuedNow };
};
