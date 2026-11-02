import { ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRemoveRule, useRules } from "@/lib/queries";

// The tools you said to always allow in a folder on a device. They stop asking in that folder until you remove the rule here. The
// device's own allow list still has the last word: a rule never lets a tool run that the device does not allow.
export const PermissionsView = () => {
  const rules = useRules();
  const remove = useRemoveRule();
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Permissions</h1>
          <p className="text-muted-foreground">Tools you chose to always allow in a project. Each conversation also has its own mode (ask, accept edits, plan first, run without asking) next to the message box.</p>
        </div>
        {rules.isPending ? <p className="text-muted-foreground">Loading...</p> : null}
        {rules.data?.length === 0 ? <p className="text-muted-foreground">Nothing is remembered. Choose "Allow always in this project" on an approval to add a rule.</p> : null}
        {rules.data && rules.data.length > 0
          ? (
              <ul className="grid divide-y rounded-xl border bg-card shadow-card" aria-label="Remembered rules">
                {rules.data.map((r) => {
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                      <ShieldCheck className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 break-all">
                        <span className="font-mono text-[13px] font-semibold">{r.tool}</span>
                        <span className="text-muted-foreground"> always allowed in {r.device}:{r.root}</span>
                      </span>
                      <Button variant="subtle" size="icon" aria-label={`Remove the rule for ${r.tool} in ${r.device}:${r.root}`} onClick={() => {
                        remove.mutate(r.id);
                      }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )
          : null}
      </div>
    </div>
  );
};
