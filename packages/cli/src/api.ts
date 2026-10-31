import { authHeaders, textOf, type ChatMessage, type NodeRecord, type Tool } from "@harness/core";

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
