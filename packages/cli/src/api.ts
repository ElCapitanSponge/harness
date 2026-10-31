import { authHeaders, type ChatMessage, type NodeRecord } from "@harness/core";

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

  async chat(model: string, messages: ChatMessage[]): Promise<ChatReply> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(this.apiKey) },
      body: JSON.stringify({ model, messages }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    if (!res.ok) throw new Error(body.error?.message ?? `gateway returned ${res.status}`);
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("gateway returned no completion");
    return { text, model: body.model ?? model, node: res.headers.get("x-harness-node") ?? "unknown" };
  }
}
