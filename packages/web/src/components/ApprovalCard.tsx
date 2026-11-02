import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { ApprovalPreview } from "@harness/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { cn } from "@/lib/utils";

export interface ApprovalItem {
  approvalId: string;
  tool: string;
  summary: string;
  status: "pending" | "allowed" | "declined";
  preview?: ApprovalPreview;
  // Why the person declined, if they said.
  reason?: string;
}

export type Answer = (approvalId: string, approve: boolean, always: boolean | "project", reason?: string) => void;

// What will happen, shown before it does: the diff of an edit with the colours of the side panel, the whole command and where it runs,
// or the start of the file that will be written.
const Preview = ({ preview }: { preview: ApprovalPreview }) => {
  return (
    <div className="grid gap-1" aria-label="What will happen">
      <div className="break-all text-xs font-semibold text-muted-foreground">{preview.title}</div>
      <pre className="max-h-64 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/40 py-1 font-mono text-xs">
        {preview.text.split("\n").map((line, i) => {
          const diff = preview.kind === "diff";
          return (
            <div key={`${String(i)}-${line.slice(0, 12)}`} className={cn("whitespace-pre-wrap px-2 [overflow-wrap:anywhere]", diff && line.startsWith("+") && "bg-success/15 text-success", diff && line.startsWith("-") && "bg-destructive/15 text-destructive", diff && line.startsWith("@@") && "text-muted-foreground")}>
              {line === "" ? " " : line}
            </div>
          );
        })}
      </pre>
    </div>
  );
};

// Approval for a change: what it is, what it will do, and the ways to answer. Allow once; allow for the rest of this conversation;
// allow always in this project (remembered, and removable in Permissions); or decline, with a reason that goes back to the model.
export const ApprovalCard = ({ item, onAnswer }: { item: ApprovalItem; onAnswer: Answer }) => {
  const [reason, setReason] = useState("");
  const pending = item.status === "pending";
  const plan = item.tool === "plan";
  return (
    <div className="px-10">
      <div className={cn("grid gap-2 rounded-lg border border-primary bg-card p-3 shadow-card", !pending && "border-border opacity-80 shadow-none")} role="group" aria-label={plan ? "Plan approval" : "Approval"}>
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <ShieldQuestion className="size-4 text-primary" />
          {plan ? "Approve the plan" : `Approval needed: ${item.tool}`}
          {item.status === "allowed" ? " (allowed)" : item.status === "declined" ? " (declined)" : ""}
        </div>
        <div className="break-all font-mono text-[13px]">{item.summary}</div>
        {item.preview ? <Preview preview={item.preview} /> : null}
        {item.status === "declined" && item.reason ? <p className="text-[13px] text-muted-foreground">Reason given: {item.reason}</p> : null}
        {pending
          ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => {
                    onAnswer(item.approvalId, true, false);
                  }}
                  >
                    {plan ? "Approve the plan" : "Allow"}
                  </Button>
                  {plan
                    ? null
                    : (
                        <>
                          <Button onClick={() => {
                            onAnswer(item.approvalId, true, true);
                          }}
                          >
                            Allow {item.tool} for this conversation
                          </Button>
                          <Button onClick={() => {
                            onAnswer(item.approvalId, true, "project");
                          }}
                          >
                            Allow {item.tool} always in this project
                          </Button>
                        </>
                      )}
                  <Button variant="subtle" onClick={() => {
                    if (reason.trim()) {
                      onAnswer(item.approvalId, false, false, reason.trim());
                    } else {
                      onAnswer(item.approvalId, false, false);
                    }
                  }}
                  >
                    Decline
                  </Button>
                </div>
                <Input aria-label="Reason for declining (optional)" placeholder="Tell the model why, if you decline (optional)" value={reason} onChange={(ev) => {
                  setReason(ev.target.value);
                }}
                />
              </>
            )
          : null}
      </div>
    </div>
  );
};
