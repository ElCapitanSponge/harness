import { Popover } from "radix-ui";
import { Gauge, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compact } from "@/lib/format";
import { useCompactConversation, useConversationUsage } from "@/lib/queries";
import { cn } from "@/lib/utils";

// How full the model's context window was after the latest call, with what each model has used in this conversation, and a
// way to compact it now. A number marked "~" is an estimate, because the model server reported no count. The tick on the bar
// is where the conversation compacts itself.
export const ContextMeter = ({ id, busy = false }: { id: string; busy?: boolean }) => {
  const usage = useConversationUsage(id);
  const compactNow = useCompactConversation(id);
  const data = usage.data;
  const last = data?.last;
  if (!data || !last) {
    return null;
  }
  const used = last.promptTokens + last.completionTokens;
  const window = last.contextLength;
  const fraction = window ? Math.min(used / window, 1) : undefined;
  const threshold = data.compactAt ?? 0;
  const mark = last.estimated ? "~" : "";
  const tone = fraction === undefined ? "bg-primary" : fraction >= (threshold || 0.9) ? "bg-destructive" : fraction > 0.6 ? "bg-warning" : "bg-primary";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground pointer-coarse:min-h-11 hover:bg-muted">
          <Gauge className="size-3.5" />
          <span>{mark}{compact(used)}{window ? ` / ${compact(window)}` : ""}</span>
          {fraction === undefined
            ? null
            : (
                <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Context window used" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span className={cn("block h-full rounded-full", tone)} style={{ width: `${String(Math.round(fraction * 100))}%` }} />
                  {threshold > 0 ? <span className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${String(Math.round(threshold * 100))}%` }} aria-hidden /> : null}
                </span>
              )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-raised">
          <div className="mb-2 font-semibold">Context</div>
          <p className="mb-3 text-muted-foreground">
            {mark}{used.toLocaleString()} tokens in the conversation so far{window ? `, of ${window.toLocaleString()} that ${last.model} can hold` : ""}.
            {last.estimated ? " The model server reported no counts, so these are estimates." : ""}
          </p>
          <p className="mb-3 text-muted-foreground">
            {threshold > 0 ? `It compacts itself at ${String(Math.round(threshold * 100))}%: the older turns are replaced by a summary the model writes, and the latest turns stay as they are. What you see here does not change.` : "Automatic compaction is off."}
          </p>
          <Button className="mb-1" disabled={busy || compactNow.isPending} onClick={() => {
            compactNow.mutate();
          }}
          >
            <Layers /> {compactNow.isPending ? "Compacting..." : "Compact now"}
          </Button>
          {compactNow.error ? <p className="mb-2 text-xs text-destructive" role="alert">{compactNow.error.message}</p> : null}
          {busy ? <p className="mb-2 text-xs text-muted-foreground">Wait for the reply to finish first.</p> : null}
          <div className="mb-1 mt-3 font-semibold">By model</div>
          <table className="w-full text-[13px]">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-1 font-normal">Model</th><th className="text-right font-normal">Calls</th><th className="text-right font-normal">In</th><th className="text-right font-normal">Out</th></tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => {
                return (
                  <tr key={`${m.device}/${m.model}`} className="border-t">
                    <td className="py-1 [overflow-wrap:anywhere]">{m.model}<span className="block text-xs text-muted-foreground">{m.device}</span></td>
                    <td className="text-right">{m.calls}</td>
                    <td className="text-right">{m.estimated ? "~" : ""}{compact(m.promptTokens)}</td>
                    <td className="text-right">{m.estimated ? "~" : ""}{compact(m.completionTokens)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
