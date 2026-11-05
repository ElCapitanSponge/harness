import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { Answer, ApprovalItem } from "@/components/ApprovalCard";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { cn } from "@/lib/utils";

const outcomeOf = (status: ApprovalItem["status"]): string => {
  if (status === "allowed") {
    return " (approved)";
  }
  return status === "declined" ? " (changes requested)" : "";
};

// Approval of a plan, which is a document: read it as markdown, edit it (the edit goes back to the model as the approved plan), ask for
// changes (a decline with a reason), or approve and choose what follows, asking before each change or accepting file edits.
export const PlanApproval = ({ item, onAnswer }: { item: ApprovalItem; onAnswer: Answer }) => {
  const original = item.preview?.text ?? item.summary;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const [reason, setReason] = useState("");
  const pending = item.status === "pending";
  const edited = draft.trim() !== "" && draft.trim() !== original.trim();

  const approve = (next: "ask" | "edits"): void => {
    onAnswer(item.approvalId, true, false, undefined, { next, ...(edited ? { plan: draft.trim() } : {}) });
  };
  const requestChanges = (): void => {
    if (reason.trim()) {
      onAnswer(item.approvalId, false, false, reason.trim());
    } else {
      onAnswer(item.approvalId, false, false);
    }
  };

  return (
    <div className="px-10">
      <div className={cn("grid gap-2 rounded-lg border border-primary bg-card p-3 shadow-card", !pending && "border-border opacity-80 shadow-none")} role="group" aria-label="Plan approval">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <ShieldQuestion className="size-4 text-primary" />
          Approve the plan{outcomeOf(item.status)}
        </div>
        {pending
          ? (
              <>
                {editing
                  ? (
                      <Textarea aria-label="Edit the plan" rows={14} className="font-mono text-[13px]" value={draft} onChange={(ev) => {
                        setDraft(ev.target.value);
                      }}
                      />
                    )
                  : (
                      <section aria-label="The plan" className="max-h-96 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/40 p-3 text-[13px]">
                        <Markdown text={edited ? draft : original} />
                      </section>
                    )}
                {edited ? <p className="text-xs text-muted-foreground">You edited the plan. Your version goes back to the model as the approved plan.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => {
                    approve("ask");
                  }}
                  >
                    Approve, ask before each change
                  </Button>
                  <Button onClick={() => {
                    approve("edits");
                  }}
                  >
                    Approve, accept file edits
                  </Button>
                  <Button variant="subtle" aria-pressed={editing} onClick={() => {
                    setEditing(!editing);
                  }}
                  >
                    {editing ? "Done editing" : "Edit"}
                  </Button>
                  <Button variant="subtle" onClick={requestChanges}>Request changes</Button>
                </div>
                <Input aria-label="What to change (optional)" placeholder="Tell the model what to change, if you request changes (optional)" value={reason} onChange={(ev) => {
                  setReason(ev.target.value);
                }}
                />
              </>
            )
          : (
              <>
                {item.status === "declined" && item.reason ? <p className="text-[13px] text-muted-foreground">Changes requested: {item.reason}</p> : null}
                <details className="text-[13px]">
                  <summary className="w-fit cursor-pointer text-xs font-semibold text-muted-foreground">Show the plan</summary>
                  <div className="mt-1 max-h-96 overflow-y-auto overflow-x-hidden"><Markdown text={edited ? draft : original} /></div>
                </details>
              </>
            )}
      </div>
    </div>
  );
};
