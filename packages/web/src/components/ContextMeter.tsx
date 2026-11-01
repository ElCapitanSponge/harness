import { Popover } from "radix-ui";
import { Gauge } from "lucide-react";
import { useConversationUsage } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const compact = (n: number): string => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${String(Math.round(n / 1000))}k`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
};

// How full the model's context window was after the latest call, with what each model has used in this conversation.
// A number marked "~" is an estimate, because the model server reported no count.
export const ContextMeter = ({ id }: { id: string }) => {
  const usage = useConversationUsage(id);
  const data = usage.data;
  const last = data?.last;
  if (!data || !last) {
    return null;
  }
  const used = last.promptTokens + last.completionTokens;
  const window = last.contextLength;
  const fraction = window ? Math.min(used / window, 1) : undefined;
  const mark = last.estimated ? "~" : "";
  const tone = fraction === undefined ? "bg-primary" : fraction > 0.9 ? "bg-destructive" : fraction > 0.75 ? "bg-warning" : "bg-primary";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
          <Gauge className="size-3.5" />
          <span>{mark}{compact(used)}{window ? ` / ${compact(window)}` : ""}</span>
          {fraction === undefined
            ? null
            : (
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Context window used" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span className={cn("block h-full rounded-full", tone)} style={{ width: `${String(Math.round(fraction * 100))}%` }} />
                </span>
              )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-raised">
          <div className="mb-2 font-semibold">Context</div>
          <p className="mb-3 text-muted-foreground">
            {mark}{used.toLocaleString()} tokens in the conversation so far{window ? `, of ${window.toLocaleString()} that ${last.model} can hold` : ""}.
            {last.estimated ? " The model server reported no counts, so these are estimates." : ""}
          </p>
          <div className="mb-1 font-semibold">By model</div>
          <table className="w-full text-[13px]">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-1 font-normal">Model</th><th className="text-right font-normal">Calls</th><th className="text-right font-normal">In</th><th className="text-right font-normal">Out</th></tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => {
                return (
                  <tr key={`${m.device}/${m.model}`} className="border-t">
                    <td className="py-1">{m.model}<span className="block text-xs text-muted-foreground">{m.device}</span></td>
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
