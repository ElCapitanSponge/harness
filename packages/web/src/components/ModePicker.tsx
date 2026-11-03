import type { PermissionMode } from "@harness/core";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Choice } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/overlay";
import { MODE_OPTIONS } from "@/lib/modes";

// How this conversation treats changes. "Run without asking" is never the default, is marked as the risky one, and asks to be confirmed.
// Choosing it only opens the question: the mode stays as it was until the person confirms.
export const ModePicker = ({ value, onChange, disabled, className }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean; className?: string }) => {
  const [asking, setAsking] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      {value === "bypass" ? <TriangleAlert className="size-4 text-warning" aria-label="Nothing asks in this mode" /> : null}
      <Choice
        label="Changes"
        className={className}
        disabled={disabled ?? false}
        value={value}
        groups={[{
          options: MODE_OPTIONS.map((o) => {
            return o.value === "bypass"
              ? { value: o.value, label: o.label, detail: o.hint, badge: "risky", badgeTone: "warning" as const }
              : { value: o.value, label: o.label, detail: o.hint };
          }),
        }]}
        onValueChange={(chosen) => {
          const next = MODE_OPTIONS.find((o) => {
            return o.value === chosen;
          })?.value;
          if (next === "bypass") {
            setAsking(true);
            return;
          }
          if (next) {
            onChange(next);
          }
        }}
      />
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Run without asking?"
        description="The model will be able to change files and run commands on the device without asking you first. The device's own allow list still applies."
        confirmLabel="Run without asking"
        tone="risky"
        onConfirm={() => {
          setAsking(false);
          onChange("bypass");
        }}
      />
    </span>
  );
};
