import { ArrowLeft, Check, CircleDot, FilePlus2, FileText, ListChecks, Circle, Terminal, X } from "lucide-react";
import { useState } from "react";
import type { PlanStep } from "@harness/core";
import { Button } from "@/components/ui/button";
import type { ChangedFile } from "@/lib/conversation";
import type { BackgroundTask } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<PlanStep["status"], { icon: typeof Check; label: string }> = {
  done: { icon: Check, label: "done" },
  in_progress: { icon: CircleDot, label: "in progress" },
  pending: { icon: Circle, label: "to do" },
};

const Plan = ({ steps }: { steps: PlanStep[] }) => {
  return (
    <section aria-label="Plan" className="grid gap-1">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ListChecks className="size-4" /> Plan</h3>
      <ol className="grid gap-1">
        {steps.map((s, i) => {
          const { icon: Icon, label } = STATUS[s.status];
          return (
            <li key={`${String(i)}-${s.text}`} className={cn("flex items-start gap-2 text-[13px]", s.status === "done" && "text-muted-foreground line-through", s.status === "in_progress" && "font-semibold")}>
              <Icon className={cn("mt-0.5 size-4 shrink-0", s.status === "in_progress" && "text-primary")} aria-label={label} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{s.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

// A diff in unified hunks: added lines green, removed lines red, hunk headers muted. Long lines wrap rather than scroll.
const Diff = ({ patch }: { patch: string }) => {
  return (
    <pre className="overflow-hidden rounded-md border bg-muted/40 py-1 font-mono text-xs">
      {patch.split("\n").map((line, i) => {
        return (
          <div key={`${String(i)}-${line.slice(0, 12)}`} className={cn("whitespace-pre-wrap px-2 [overflow-wrap:anywhere]", line.startsWith("+") && "bg-success/15 text-success", line.startsWith("-") && "bg-destructive/15 text-destructive", line.startsWith("@@") && "text-muted-foreground")}>
            {line === "" ? " " : line}
          </div>
        );
      })}
    </pre>
  );
};

const FileDetail = ({ file, onBack }: { file: ChangedFile; onBack: () => void }) => {
  return (
    <section aria-label={`Changes to ${file.path}`} className="grid gap-2">
      <Button variant="subtle" size="sm" className="w-fit" onClick={onBack}><ArrowLeft /> All files</Button>
      <div className="flex items-center gap-2">
        {file.created ? <FilePlus2 className="size-4 shrink-0 text-success" /> : <FileText className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold">{file.path}</span>
        <Counts file={file} />
      </div>
      {file.diffs.map((d, i) => {
        return (
          <div key={String(i)} className="grid gap-1">
            {file.diffs.length > 1 ? <div className="text-xs text-muted-foreground">Change {i + 1} of {file.diffs.length}</div> : null}
            {d.patch ? <Diff patch={d.patch} /> : <p className="text-[13px] text-muted-foreground">{d.note ?? "No difference."}</p>}
          </div>
        );
      })}
    </section>
  );
};

const Tasks = ({ tasks }: { tasks: BackgroundTask[] }) => {
  return (
    <section aria-label="Background tasks" className="grid gap-1">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Terminal className="size-4" /> Running in the background</h3>
      <ul className="grid gap-1">
        {tasks.map((t) => {
          return (
            <li key={t.id} className="flex items-center gap-2 text-[13px]">
              <span className={cn("size-2 shrink-0 rounded-full", t.status === "running" ? "bg-success" : "bg-muted-foreground")} aria-hidden />
              <span className="min-w-0 flex-1 break-all font-mono text-xs">{t.command}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t.status === "running" ? "running" : t.status === "stopped" ? "stopped" : `exited${t.code === undefined || t.code === null ? "" : ` (${String(t.code)})`}`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const Counts = ({ file }: { file: ChangedFile }) => {
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className="text-success">+{file.added}</span> <span className="text-destructive">-{file.removed}</span>
    </span>
  );
};

// What the session has done, beside the conversation: the model's plan and the files it changed or created, newest first. A file
// opens to its diff. At phone width it is a drawer over the conversation.
export const SidePanel = ({ changes, plan, tasks = [], onClose }: { changes: ChangedFile[]; plan: PlanStep[]; tasks?: BackgroundTask[]; onClose: () => void }) => {
  const [openPath, setOpenPath] = useState<string | undefined>();
  const open = changes.find((f) => {
    return f.path === openPath;
  });

  return (
    <aside aria-label="Session panel" className="fixed inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l bg-card shadow-card lg:static lg:z-auto lg:w-80 lg:max-w-none lg:shrink-0 lg:shadow-none">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">This session</h2>
        <Button variant="subtle" size="icon" className="size-7" aria-label="Close panel" onClick={onClose}><X /></Button>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overflow-x-hidden p-3">
        {open
          ? (
              <FileDetail file={open} onBack={() => {
                setOpenPath(undefined);
              }}
              />
            )
          : (
              <>
                {plan.length > 0 ? <Plan steps={plan} /> : null}
                {tasks.length > 0 ? <Tasks tasks={tasks} /> : null}
                <section aria-label="Changed files" className="grid gap-1">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><FileText className="size-4" /> Files</h3>
                  {changes.length === 0 ? <p className="text-[13px] text-muted-foreground">No file has been changed yet.</p> : null}
                  <ul className="grid gap-1">
                    {changes.map((f) => {
                      return (
                        <li key={f.path}>
                          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => {
                            setOpenPath(f.path);
                          }}
                          >
                            {f.created ? <FilePlus2 className="size-4 shrink-0 text-success" aria-label="created" /> : <FileText className="size-4 shrink-0" />}
                            <span className="min-w-0 flex-1 break-all font-mono text-xs">{f.path}</span>
                            <Counts file={f} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
      </div>
    </aside>
  );
};
