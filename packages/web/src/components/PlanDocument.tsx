import { Check, ChevronLeft, ChevronRight, Copy, Download, FileText } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import type { PlanVersion } from "@/lib/conversation";
import { saveText } from "@/lib/download";

// The plan as a document in the session panel: the version in force, kept after it is approved, with the earlier versions a step back,
// and a way to copy it or save it as a .md file.
export const PlanDocument = ({ versions }: { versions: PlanVersion[] }) => {
  // Follows the latest version until the person steps back to an earlier one.
  const [chosen, setChosen] = useState<number | undefined>();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const last = versions.length - 1;
  const index = chosen === undefined ? last : Math.min(chosen, last);
  const current = versions[index];
  if (!current) {
    return null;
  }
  const go = (to: number): void => {
    setChosen(to >= last ? undefined : Math.max(0, to));
  };

  return (
    <section aria-label="Plan document" className="grid gap-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><FileText className="size-4" /> Plan document</h3>
      {versions.length > 1
        ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Button type="button" variant="subtle" size="icon" className="size-6" aria-label="Older version" disabled={index === 0} onClick={() => {
                go(index - 1);
              }}
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-0 flex-1 text-center">Version {current.version} of {versions.length}, {current.by === "person" ? "edited by you" : "written by the model"}</span>
              <Button type="button" variant="subtle" size="icon" className="size-6" aria-label="Newer version" disabled={index === last} onClick={() => {
                go(index + 1);
              }}
              >
                <ChevronRight />
              </Button>
            </div>
          )
        : null}
      <div className="max-h-80 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/40 p-2 text-[13px]">
        <Markdown text={current.markdown} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="subtle" size="sm" onClick={() => {
          void copyText(current.markdown).then((ok) => {
            setCopy(ok ? "copied" : "failed");
            setTimeout(() => {
              setCopy("idle");
            }, 1500);
          });
        }}
        >
          {copy === "copied" ? <Check /> : <Copy />}
          {copy === "copied" ? "Copied" : copy === "failed" ? "Could not copy" : "Copy"}
        </Button>
        <Button type="button" variant="subtle" size="sm" onClick={() => {
          saveText(versions.length > 1 ? `plan-v${String(current.version)}.md` : "plan.md", current.markdown);
        }}
        >
          <Download /> Download .md
        </Button>
      </div>
    </section>
  );
};
