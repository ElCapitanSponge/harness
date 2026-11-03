import type { PermissionMode } from "@harness/core";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/overlay";
import { MODE_OPTIONS } from "@/lib/modes";

// How this conversation treats changes. "Run without asking" is never the default, is marked as the risky one, and asks to be confirmed.
// Choosing it only opens the question: the mode stays as it was until the person confirms.
export const ModePicker = ({ value, onChange, disabled, className }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean; className?: string }) => {
  const [asking, setAsking] = useState(false);
  const current = MODE_OPTIONS.find((o) => {
    return o.value === value;
  });
  return (
    <span className="inline-flex items-center gap-1">
      {value === "bypass" ? <TriangleAlert className="size-4 text-warning" aria-label="Nothing asks in this mode" /> : null}
      <Select
        aria-label="Changes"
        title={current?.hint}
        className={className}
        disabled={disabled}
        value={value}
        onChange={(ev) => {
          const next = MODE_OPTIONS.find((o) => {
            return o.value === ev.target.value;
          })?.value;
          if (next === "bypass") {
            setAsking(true);
            return;
          }
          if (next) {
            onChange(next);
          }
        }}
      >
        {MODE_OPTIONS.map((o) => {
          return <option key={o.value} value={o.value}>{o.value === "bypass" ? `${o.label} (risky)` : o.label}</option>;
        })}
      </Select>
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
