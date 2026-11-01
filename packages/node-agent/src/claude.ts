import { ChatRequest, type RelayRequest, type TunnelMessage } from "@harness/core";
import { ClaudeLimitError, runClaude, type ClaudeResult } from "@harness/claude";

type ClaudeMessage = Extract<RelayRequest, { type: "claude" }>;

// Answers Claude requests with the official `claude` CLI on this device, using the login already on it.
// The harness never reads or forwards that login; it only starts the CLI and returns what it printed.
export const createClaudeServer = (opts: { bin: string; enabled?: () => boolean; run?: (bin: string, req: ChatRequest) => Promise<ClaudeResult> }) => {
  const run = opts.run ?? runClaude;
  return {
    async handle(msg: ClaudeMessage, send: (m: TunnelMessage) => void): Promise<void> {
      if (opts.enabled && !opts.enabled()) {
        send({ type: "tool-result", id: msg.id, ok: false, output: "Claude is not enabled on this device" });
        return;
      }
      try {
        const parsed = ChatRequest.safeParse(JSON.parse(msg.body));
        if (!parsed.success) {
          throw new Error("invalid chat request");
        }
        // Client-side tools are not passed to Claude; the gateway refuses them before they get here.
        const result = await run(opts.bin, parsed.data);
        send({ type: "tool-result", id: msg.id, ok: true, output: JSON.stringify(result) });
      } catch (err) {
        // A refusal for hitting a usage limit travels as data, so the gateway can stop offering Claude until it ends.
        const output = err instanceof ClaudeLimitError ? JSON.stringify({ limited: true, message: err.message, limits: err.limits }) : (err as Error).message;
        send({ type: "tool-result", id: msg.id, ok: false, output });
      }
    },
  };
};

export type ClaudeServer = ReturnType<typeof createClaudeServer>;
