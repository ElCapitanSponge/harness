import { ChevronRight, FileText, Loader2, Pencil, Search, Terminal, TriangleAlert, Wrench } from "lucide-react";
import { useState } from "react";
import { Diff } from "@/components/Diff";
import { kindOf, summariseActions, type ActionEntry, type ActionKind } from "@/lib/actions";
import type { Item } from "@/lib/conversation";
import { cn } from "@/lib/utils";

const ICONS: Record<ActionKind, typeof Wrench> = {
  read: FileText,
  search: Search,
  command: Terminal,
  modified: Pencil,
  other: Wrench,
};

// What one action shows when opened: the diff of a change, or what the tool returned.
const detailOf = (entry: ActionEntry) => {
  if (entry.change) {
    return entry.change.patch ? <Diff patch={entry.change.patch} /> : <p className="text-[13px] text-muted-foreground">{entry.change.note ?? "No difference."}</p>;
  }
  if (entry.output) {
    return <pre className={cn("max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs [overflow-wrap:anywhere]", entry.failed && "text-destructive")}>{entry.output}</pre>;
  }
  return null;
};

const Entry = ({ entry, running }: { entry: ActionEntry; running: boolean }) => {
  const Icon = ICONS[kindOf(entry)];
  const detail = detailOf(entry);
  const head = (
    <>
      <Icon className="size-3.5 shrink-0" />
      {entry.change
        ? <span className="min-w-0 break-all"><span className="font-semibold">Modified</span> <span className="font-mono">{entry.change.path}</span></span>
        : <span className="min-w-0 break-all font-mono">{entry.summary}</span>}
      {running ? <Loader2 className="size-3 shrink-0 animate-spin" aria-label="running" /> : null}
      {entry.failed ? <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-label="failed" /> : null}
    </>
  );
  if (!detail) {
    return <li className="flex items-center gap-1.5 px-1 py-0.5 text-xs">{head}</li>;
  }
  return (
    <li>
      <details className="group/entry">
        <summary className="flex w-full cursor-pointer list-none items-center pointer-coarse:min-h-11 gap-1.5 rounded-md px-1 py-0.5 text-xs hover:bg-muted">
          <ChevronRight className="size-3 shrink-0 transition-transform group-open/entry:rotate-90" />
          {head}
        </summary>
        <div className="mt-1 mb-1 ml-4">{detail}</div>
      </details>
    </li>
  );
};

// A run of the model's tool calls, folded as thinking is: open while it runs and folded when it ends, and the person's own choice to open
// or close it is kept while the page is open. An approval or question that ended the run is shown outside it.
export const Actions = ({ item }: { item: Extract<Item, { kind: "actions" }> }) => {
  const [chosen, setChosen] = useState<boolean | undefined>();
  const open = chosen ?? item.live;
  const failed = item.entries.some((e) => {
    return e.failed === true;
  });
  return (
    <details className="group rounded-lg text-muted-foreground" open={open}>
      <summary
        className="flex w-fit max-w-full cursor-pointer list-none items-center pointer-coarse:min-h-11 gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold hover:bg-muted"
        onClick={(ev) => {
          // The open state is ours, so a group that opens and folds by itself is not taken for a choice.
          ev.preventDefault();
          setChosen(!open);
        }}
      >
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <Wrench className="size-3.5 shrink-0" />
        <span className={cn("min-w-0 truncate", failed && "text-destructive")}>{summariseActions(item.entries)}</span>
        {item.live ? <Loader2 className="size-3 shrink-0 animate-spin" aria-label="working" /> : null}
      </summary>
      <ul className="mt-1 grid gap-0.5 border-l-2 pl-3">
        {item.entries.map((entry, i) => {
          return <Entry key={`${String(i)}-${entry.summary}`} entry={entry} running={item.live && i === item.entries.length - 1 && entry.output === undefined && entry.change === undefined} />;
        })}
      </ul>
    </details>
  );
};
