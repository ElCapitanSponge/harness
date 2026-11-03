import { barY, colorLegend, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { useMemo, useState } from "react";
import { ClaudePlan } from "@/components/ClaudeMeter";
import { compact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useClaudeStatus, useUsage } from "@/lib/queries";
import type { ModelUsage, UsageSummary } from "@/lib/types";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

const PALETTE = ["#c8321f", "#1f5a73", "#4d7c2f", "#a16207", "#8b3a62", "#6b6259"];

const Tokens = ({ value, estimated }: { value: number; estimated?: boolean }) => {
  return <span title={value.toLocaleString()}>{estimated ? "~" : ""}{compact(value)}</span>;
};

const DailyChart = ({ rows }: { rows: UsageSummary["byDay"] }) => {
  const definition = useMemo(() => {
    // A fixed colour for each model, in the order they first appear, so a model keeps its colour as the range changes.
    const models = [...new Set(rows.map((r) => {
      return r.model;
    }))];
    const color = scaleOrdinal<string, string>().domain(models).range(PALETTE);
    return defineChart({
      marks: [barY(rows, { x: "day", y: "tokens", color: "model" })],
      color: { scale: color, legend: colorLegend({ label: "Model" }) },
      scales: {
        x: { scale: () => {
          return scaleBand().padding(0.2);
        } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: "Tokens", ticks: { format: (value: number) => {
          return compact(value);
        } } } },
      },
      tooltip,
    });
  }, [rows]);
  return <Chart definition={definition} height={260} ariaLabel="Tokens used per day, by model" />;
};

const Table = ({ title, rows }: { title: string; rows: { key: string; name: string; sub?: string; calls: number; promptTokens: number; completionTokens: number; estimated?: boolean }[] }) => {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {rows.length === 0
        ? <p className="text-muted-foreground">Nothing yet.</p>
        : (
            <table className="w-full text-[13px]">
              <thead className="text-left text-muted-foreground">
                <tr><th className="py-1 font-normal">Name</th><th className="text-right font-normal">Calls</th><th className="text-right font-normal">In</th><th className="text-right font-normal">Out</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  return (
                    <tr key={r.key} className="border-t">
                      <td className="py-1.5 [overflow-wrap:anywhere]">{r.name}{r.sub ? <span className="block text-xs text-muted-foreground">{r.sub}</span> : null}</td>
                      <td className="text-right">{r.calls}</td>
                      <td className="text-right"><Tokens value={r.promptTokens} estimated={r.estimated} /></td>
                      <td className="text-right"><Tokens value={r.completionTokens} estimated={r.estimated} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
    </section>
  );
};

export const UsageView = () => {
  const [days, setDays] = useState<number>(7);
  const usage = useUsage(days);
  const claude = useClaudeStatus().data;
  const data = usage.data;
  const anyEstimated = data?.byModel.some((m: ModelUsage) => {
    return m.estimated;
  });

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Usage</h1>
            <p className="text-muted-foreground">Tokens used by every model call, on every device.</p>
          </div>
          <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Range">
            {RANGES.map((r) => {
              return (
                <button key={r.days} type="button" aria-pressed={days === r.days} className={cn("rounded-md px-3 py-1 font-semibold text-muted-foreground pointer-coarse:min-h-11 hover:text-foreground", days === r.days && "bg-accent text-accent-foreground")} onClick={() => {
                  setDays(r.days);
                }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {claude && (claude.device || claude.limitedUntil !== undefined)
          ? (
              <section className="rounded-xl border bg-card p-4 shadow-card">
                <h2 className="mb-2 font-semibold">Claude plan</h2>
                <ClaudePlan status={claude} detailed />
              </section>
            )
          : null}

        {usage.isPending ? <p className="text-muted-foreground">Loading...</p> : null}
        {usage.error ? <p className="text-destructive" role="alert">{usage.error.message}</p> : null}

        {data
          ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[["Calls", data.calls], ["Tokens in", data.promptTokens], ["Tokens out", data.completionTokens]].map(([label, value]) => {
                    return (
                      <div key={label} className="rounded-xl border bg-card p-4 shadow-card">
                        <div className="text-muted-foreground">{label}</div>
                        <div className="text-2xl font-semibold"><Tokens value={value as number} estimated={label !== "Calls" && anyEstimated} /></div>
                      </div>
                    );
                  })}
                </div>
                {anyEstimated ? <p className="text-[13px] text-muted-foreground">A number starting with ~ includes estimates: Claude and some model servers report no token counts.</p> : null}

                {data.byDay.length > 0
                  ? (
                      <section className="rounded-xl border bg-card p-4 shadow-card">
                        <h2 className="mb-2 font-semibold">Per day</h2>
                        <DailyChart rows={data.byDay} />
                      </section>
                    )
                  : null}

                <Table
                  title="By model"
                  rows={data.byModel.map((m) => {
                    return { key: `${m.device}/${m.model}`, name: m.model, sub: m.device, calls: m.calls, promptTokens: m.promptTokens, completionTokens: m.completionTokens, estimated: m.estimated };
                  })}
                />
                <Table
                  title="By device"
                  rows={data.byDevice.map((d) => {
                    return { key: d.device, name: d.device, calls: d.calls, promptTokens: d.promptTokens, completionTokens: d.completionTokens };
                  })}
                />
              </>
            )
          : null}
      </div>
    </div>
  );
};
