import { authHeaders, sseData, textOf, type ChatMessage, type DeviceToolResult, type LiveSessionEvent, type NodeRecord, type SessionEvent, type SessionInfo, type SettingsReport, type Tool } from "@harness/core";

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

export { sseData };

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
    if (res.status === 401) {
      throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    }
    if (!res.ok) {
      throw new Error(`gateway returned ${res.status}`);
    }
    return (await res.json()) as NodeRecord[];
  }

  // Runs one tool on a connected device, inside one of its project roots.
  async deviceTool(device: string, root: string, name: string, args: Record<string, unknown>): Promise<DeviceToolResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/devices/${encodeURIComponent(device)}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(this.apiKey) },
      body: JSON.stringify({ root, name, args }),
    });
    const body = (await res.json().catch(() => {
      return {};
    })) as { error?: { message?: string } } & Partial<DeviceToolResult>;
    if (res.status === 401) {
      throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    }
    if (!res.ok) {
      throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    }
    return { ok: body.ok ?? false, output: body.output ?? "" };
  }

  private async check(res: Response): Promise<void> {
    if (res.ok) {
      return;
    }
    if (res.status === 401) {
      throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    }
    const body = (await res.json().catch(() => {
      return {};
    })) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
  }

  private json(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json", ...authHeaders(this.apiKey) }, body: JSON.stringify(body) };
  }

  // Saved conversations, most recently active first.
  async sessions(): Promise<SessionInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/sessions`, { headers: authHeaders(this.apiKey), signal: AbortSignal.timeout(5000) });
    await this.check(res);
    return (await res.json()) as SessionInfo[];
  }

  // A device's effective settings, or, with a change, the settings after it.
  async deviceSettings(device: string, change?: Record<string, unknown>): Promise<SettingsReport> {
    const url = `${this.baseUrl}/devices/${encodeURIComponent(device)}/settings`;
    const res = await this.fetchImpl(url, change ? { ...this.json(change), method: "PUT" } : { headers: authHeaders(this.apiKey) });
    await this.check(res);
    return (await res.json()) as SettingsReport;
  }

  async createSession(input: { model: string; device?: string; root?: string; autoApprove?: boolean }): Promise<SessionInfo> {
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

  // Loads or unloads a model in a connected device's LM Studio.
  async deviceModel(device: string, op: "load" | "unload", input: { model?: string; contextLength?: number }): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/devices/${encodeURIComponent(device)}/models/${op}`, this.json(input));
    const body = (await res.json().catch(() => {
      return {};
    })) as { error?: { message?: string }; ok?: boolean; output?: string };
    if (res.status === 401) {
      throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    }
    if (!res.ok) {
      throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    }
    if (!body.ok) {
      throw new Error(body.output ?? "the device refused");
    }
    return body.output ?? "";
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.check(await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/cancel`, this.json({})));
  }

  // Follows a session's events from index `from` until the caller stops iterating or aborts.
  async* sessionEvents(sessionId: string, from = 0, signal?: AbortSignal): AsyncGenerator<SessionEvent | LiveSessionEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/sessions/${sessionId}/events?from=${from}`, { headers: authHeaders(this.apiKey), signal });
    await this.check(res);
    if (!res.body) {
      return;
    }
    for await (const data of sseData(res.body)) {
      yield JSON.parse(data) as SessionEvent | LiveSessionEvent;
    }
  }

  async complete(model: string, messages: ChatMessage[], tools?: Tool[]): Promise<Completion> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(this.apiKey) },
      body: JSON.stringify({ model, messages, ...(tools?.length ? { tools } : {}) }),
    });
    const body = (await res.json().catch(() => {
      return {};
    })) as {
      error?: { message?: string };
      model?: string;
      choices?: { message?: ChatMessage }[];
    };
    if (res.status === 401) {
      throw new Error("gateway rejected the API key (set HARNESS_API_KEY)");
    }
    if (!res.ok) {
      throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    }
    const message = body.choices?.[0]?.message;
    if (!message) {
      throw new Error("gateway returned no completion");
    }
    return { message, model: body.model ?? model, node: res.headers.get("x-harness-node") ?? "unknown" };
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatReply> {
    const { message, model: used, node } = await this.complete(model, messages);
    const text = textOf(message.content);
    if (!text && !message.tool_calls?.length) {
      throw new Error("gateway returned no completion");
    }
    return { text, model: used, node };
  }
}
