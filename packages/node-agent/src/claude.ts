import { ChatRequest, type RelayRequest, type TunnelMessage } from "@harness/core";
import { runClaude, type ClaudeResult } from "@harness/claude";

type ClaudeMessage = Extract<RelayRequest, { type: "claude" }>;

// Answers Claude requests with the official `claude` CLI on this device, using the login already on it.
// The harness never reads or forwards that login; it only starts the CLI and returns what it printed.
export const createClaudeServer = (opts: { bin: string; run?: (bin: string, req: ChatRequest) => Promise<ClaudeResult> }) => {
  const run = opts.run ?? runClaude;
  return {
    async handle(msg: ClaudeMessage, send: (m: TunnelMessage) => void): Promise<void> {
      try {
        const parsed = ChatRequest.safeParse(JSON.parse(msg.body));
        if (!parsed.success) {
          throw new Error("invalid chat request");
        }
        // Client-side tools are not passed to Claude; the gateway refuses them before they get here.
        const result = await run(opts.bin, parsed.data);
        send({ type: "tool-result", id: msg.id, ok: true, output: JSON.stringify(result) });
      } catch (err) {
        send({ type: "tool-result", id: msg.id, ok: false, output: (err as Error).message });
      }
    },
  };
};

export type ClaudeServer = ReturnType<typeof createClaudeServer>;
