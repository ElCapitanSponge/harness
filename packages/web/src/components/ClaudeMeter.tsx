import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/fields";
import { useClaudeStatus } from "@/lib/queries";
import { clockTime, timeUntil } from "@/lib/time";
import type { ClaudeStatus, ClaudeWindow } from "@/lib/types";
import { cn } from "@/lib/utils";

const left = (w: ClaudeWindow): number => {
  return Math.max(0, Math.round((1 - w.utilization) * 100));
};

const Bar = ({ label, window, now }: { label: string; window: ClaudeWindow; now: number }) => {
  const used = Math.min(Math.round(window.utilization * 100), 100);
  const tone = used >= 90 ? "bg-destructive" : used >= 75 ? "bg-warning" : "bg-primary";
  return (
    <div className="grid gap-0.5">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{left(window)}% left, resets in {timeUntil(window.resetsAt * 1000, now)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${String(used)}%` }} />
      </div>
    </div>
  );
};

// The Claude plan: how much of the five-hour window and the week is left and when each resets, or plainly that it cannot be
// read yet. The program reports the plan with each reply, so there is nothing to show before the first one.
// The time, refreshed every half minute so a countdown keeps moving between refetches.
const useNow = (): number => {
  const [now, setNow] = useState(() => {
    return Date.now();
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
};

export const ClaudePlan = ({ status, at, detailed = false }: { status: ClaudeStatus; at?: number; detailed?: boolean }) => {
  const live = useNow();
  const now = at ?? live;
  return (
    <div className="grid gap-2">
      {status.limitedUntil !== undefined
        ? (
            <Badge tone="danger" className="w-fit">
              Limited until {clockTime(status.limitedUntil, now)} ({timeUntil(status.limitedUntil, now)}). Using local models.
            </Badge>
          )
        : null}
      {status.readable
        ? (
            <>
              {status.fiveHour ? <Bar label="5-hour" window={status.fiveHour} now={now} /> : null}
              {status.sevenDay ? <Bar label="Week" window={status.sevenDay} now={now} /> : null}
              {status.usingOverage && status.limitedUntil === undefined ? <p className="text-xs text-muted-foreground">Using extra usage.</p> : null}
              {detailed && status.observedAt ? <p className="text-xs text-muted-foreground">As of {clockTime(status.observedAt, now)}, from the last Claude reply.</p> : null}
            </>
          )
        : <p className="text-xs text-muted-foreground">Not read yet. Claude reports the plan with each reply, so it shows after the first one.</p>}
    </div>
  );
};

// The small version for the sidebar. Hidden until a device is logged in to Claude and has answered once, or is limited.
export const ClaudeMeter = () => {
  const data = useClaudeStatus().data;
  if (!data || (!data.device && data.limitedUntil === undefined)) {
    return null;
  }
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Sparkles className="size-3.5 text-primary" />
        Claude plan
      </div>
      <ClaudePlan status={data} />
    </div>
  );
};
