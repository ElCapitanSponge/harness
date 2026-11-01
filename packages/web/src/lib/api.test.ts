import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, authHeaders, keyStore, readEvents, setKey } from "./api";

const stream = (...chunks: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }));
};

beforeEach(() => {
  sessionStorage.clear();
  setKey("");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the gateway key", () => {
  it("is kept for the tab, sent as a bearer token, and cleared on sign out", () => {
    setKey("secret");
    expect(keyStore.state).toBe("secret");
    expect(sessionStorage.getItem("harness-key")).toBe("secret");
    expect(authHeaders()).toEqual({ authorization: "Bearer secret" });
    setKey("");
    expect(sessionStorage.getItem("harness-key")).toBeNull();
  });
});

describe("api", () => {
  it("sends the key and a JSON body, and returns the JSON answer", async () => {
    setKey("k");
    const fetchMock = vi.fn(() => {
      return Promise.resolve(new Response(JSON.stringify({ ok: 1 })));
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await api<{ ok: number }>("/x", { method: "POST", body: { a: 1 } })).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/x", expect.objectContaining({
      method: "POST",
      body: "{\"a\":1}",
      headers: { "authorization": "Bearer k", "content-type": "application/json" },
    }));
  });

  it("turns a failure into an error with the gateway's reason and the status", async () => {
    vi.stubGlobal("fetch", () => {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "no device has that model" } }), { status: 503 }));
    });
    const error = await api("/x").catch((e: unknown) => {
      return e;
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, message: "no device has that model" });
  });

  it("still gives a reason when the answer is not JSON", async () => {
    vi.stubGlobal("fetch", () => {
      return Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }));
    });
    await expect(api("/x")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });
});

describe("readEvents", () => {
  it("hands over each data line, even when an event is split across chunks", async () => {
    const seen: string[] = [];
    await readEvents(stream("data: {\"a\":", "1}\n\ndata: two\n\n: a comment\n\nevent: x\n", "data: three\n\n"), (p) => {
      seen.push(p);
    });
    expect(seen).toEqual(["{\"a\":1}", "two", "three"]);
  });

  it("ignores empty data and a response with no body", async () => {
    const seen: string[] = [];
    await readEvents(stream("data:\n\n"), (p) => {
      seen.push(p);
    });
    await readEvents(new Response(null), (p) => {
      seen.push(p);
    });
    expect(seen).toEqual([]);
  });
});
