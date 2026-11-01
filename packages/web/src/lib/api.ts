import { Store } from "@tanstack/store";

// The gateway key is kept for this browser tab only, as the old page did.
const KEY_NAME = "harness-key";

const readKey = (): string => {
  try {
    return sessionStorage.getItem(KEY_NAME) ?? "";
  } catch {
    return "";
  }
};

export const keyStore = new Store<string>(readKey());

export const setKey = (key: string): void => {
  try {
    if (key) {
      sessionStorage.setItem(KEY_NAME, key);
    } else {
      sessionStorage.removeItem(KEY_NAME);
    }
  } catch {
    // Storage can be blocked; the key then lasts until the tab reloads.
  }
  keyStore.setState(() => {
    return key;
  });
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const authHeaders = (): Record<string, string> => {
  return { authorization: `Bearer ${keyStore.state}` };
};

const errorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string };
    const error = data.error;
    if (typeof error === "string") {
      return error;
    }
    return error?.message ?? `HTTP ${String(res.status)}`;
  } catch {
    return `HTTP ${String(res.status)}`;
  }
};

export const api = async <T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> => {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: { ...authHeaders(), ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  return (await res.json()) as T;
};

// Reads a server-sent event stream and hands each data payload to `onData`.
export const readEvents = async (res: Response, onData: (payload: string) => void): Promise<void> => {
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload) {
            onData(payload);
          }
        }
      }
    }
  }
};
