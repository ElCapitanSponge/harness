import { authHeaders, textOf, type ChatMessage, type DeviceToolResult, type NodeRecord, type SessionEvent, type SessionInfo, type Tool } from "@harness/core";

export interface Completion {
  message: ChatMessage;
  model: string;
  node: string;
}

export interface ChatReply {
  text: string;
  model: string;
  node: string;
}

// Yields the `data:` payload of each server-sent event in a response body.
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join(String.fromCharCode(10));
      if (data) yield data;
    }
  }
}

export class Gateway {
  constructor(
    private baseUrl: string,
    private fetchImpl: typeof fetch = fetch,
    private apiKey?: string,
  ) {}

  async nodes(): Promise<NodeRecord[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/nodes`, {
      headers: authHeaders(this.apiKey),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    if (!res.ok) throw new Error(`gateway returned ${res.status}`);
    return (await res.json()) as NodeRecord[];
  }

  // Runs one tool on a connected device, inside one of its project roots.
  async deviceTool(device: string, root: string, name: string, args: Record<string, unknown>): Promise<DeviceToolResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/devices/${encodeURIComponent(device)}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(this.apiKey) },
      body: JSON.stringify({ root, name, args }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Partial<DeviceToolResult>;
    if (res.status === 401) throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    if (!res.ok) throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    return { ok: body.ok ?? false, output: body.output ?? "" };
  }

  private async check(res: Response): Promise<void> {
    if (res.ok) return;
    if (res.status === 401) throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
  }

  private json(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json", ...authHeaders(this.apiKey) }, body: JSON.stringify(body) };
  }

  async createSession(input: { model: string; device: string; root: string; autoApprove?: boolean }): Promise<SessionInfo> {
    const res = await this.fetchImpl(`${this.baseUrl}/sessions`, this.json(input));
    await this.check(res);
    return (await res.json()) as SessionInfo;
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    await this.check(await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/messages`, this.json({ text })));
  }

  async answerApproval(sessionId: string, approvalId: string, approve: boolean, always = false): Promise<void> {
    await this.check(await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/approvals/${approvalId}`, this.json({ approve, always })));
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.check(await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/cancel`, this.json({})));
  }

  // Follows a session's events from index `from` until the caller stops iterating or aborts.
  async *sessionEvents(sessionId: string, from = 0, signal?: AbortSignal): AsyncGenerator<SessionEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/events?from=${from}`, { headers: authHeaders(this.apiKey), signal });
    await this.check(res);
    if (!res.body) return;
    for await (const data of sseData(res.body)) yield JSON.parse(data) as SessionEvent;
  }

  async complete(model: string, messages: ChatMessage[], tools?: Tool[]): Promise<Completion> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(this.apiKey) },
      body: JSON.stringify({ model, messages, ...(tools?.length ? { tools } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      model?: string;
      choices?: { message?: ChatMessage }[];
    };
    if (res.status === 401) throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    if (!res.ok) throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("gateway returned no completion");
    return { message, model: body.model ?? model, node: res.headers.get("x-harness-node") ?? "unknown" };
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatReply> {
    const { message, model: used, node } = await this.complete(model, messages);
    const text = textOf(message.content);
    if (!text && !message.tool_calls?.length) throw new Error("gateway returned no completion");
    return { text, model: used, node };
  }
}
