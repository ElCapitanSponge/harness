import type { RelayRequest, TunnelMessage } from "@harness/core";

type Send = (msg: TunnelMessage) => void;

// Answers chat requests relayed from the gateway by calling this device's own model server on localhost
// and streaming the reply back. It only ever calls the one chat endpoint, whatever the gateway sends.
export function createChatServer(opts: { inferenceUrl: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const inflight = new Map<string, AbortController>();

  async function serve(id: string, body: string, send: Send, signal: AbortSignal): Promise<void> {
    try {
      const res = await fetchImpl(`${opts.inferenceUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
      });
      send({ type: "head", id, status: res.status, contentType: res.headers.get("content-type") ?? undefined });
      if (res.body) {
        const decoder = new TextDecoder();
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          const data = decoder.decode(chunk, { stream: true });
          if (data) send({ type: "chunk", id, data });
        }
        const rest = decoder.decode();
        if (rest) send({ type: "chunk", id, data: rest });
      }
      send({ type: "end", id });
    } catch (err) {
      if (signal.aborted) return;
      send({ type: "fail", id, message: (err as Error).message });
    } finally {
      inflight.delete(id);
    }
  }

  return {
    handle(msg: Exclude<RelayRequest, { type: "tool" }>, send: Send): void {
      if (msg.type === "cancel") {
        inflight.get(msg.id)?.abort();
        return;
      }
      const controller = new AbortController();
      inflight.set(msg.id, controller);
      void serve(msg.id, msg.body, send, controller.signal);
    },
    cancelAll(): void {
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    },
  };
}

export type ChatServer = ReturnType<typeof createChatServer>;
