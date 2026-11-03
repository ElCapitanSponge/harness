import { effortLevels, type Effort } from "@harness/core/effort";
import { Choice } from "@/components/ui/choice";

const HINTS: Record<Effort, string> = {
  low: "Fastest, with the least thinking",
  medium: "A balance of speed and thought",
  high: "More thinking before it answers",
  xhigh: "Even more thinking",
  max: "The most thinking, and the slowest",
};

// How hard the model should think, for models that can be told. It shows nothing for one that cannot, so there is no control that does
// nothing. "Default" leaves it to the model's own setting.
export const EffortPicker = ({ model, value, onChange, disabled, className }: { model: string; value: Effort | undefined; onChange: (effort: Effort | undefined) => void; disabled?: boolean; className?: string }) => {
  const levels = effortLevels(model);
  if (levels.length === 0) {
    return null;
  }
  return (
    <Choice
      label="Effort"
      className={className}
      disabled={disabled ?? false}
      value={value ?? "default"}
      groups={[{
        options: [
          { value: "default", label: "Default effort", detail: "Leave it to the model's own setting" },
          ...levels.map((level) => {
            return { value: level, label: `Effort: ${level}`, detail: HINTS[level] };
          }),
        ],
      }]}
      onValueChange={(next) => {
        onChange(levels.find((l) => {
          return l === next;
        }));
      }}
    />
  );
};
