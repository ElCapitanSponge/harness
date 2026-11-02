import type { PermissionMode } from "@harness/core";
import { TriangleAlert } from "lucide-react";
import { Select } from "@/components/ui/fields";
import { MODE_OPTIONS } from "@/lib/modes";

// How this conversation treats changes. "Run without asking" is never the default, is marked as the risky one, and asks to be confirmed.
export const ModePicker = ({ value, onChange, disabled, className }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean; className?: string }) => {
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
          if (next === "bypass" && !window.confirm("Run without asking? The model will be able to change files and run commands on the device without asking you first. The device's own allow list still applies.")) {
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
    </span>
  );
};
