import { effortLevels, type Effort } from "@harness/core/effort";
import { Select } from "@/components/ui/fields";

// How hard the model should think, for models that can be told. It shows nothing for one that cannot, so there is no control that does
// nothing. "Default" leaves it to the model's own setting.
export const EffortPicker = ({ model, value, onChange, disabled, className }: { model: string; value: Effort | undefined; onChange: (effort: Effort | undefined) => void; disabled?: boolean; className?: string }) => {
  const levels = effortLevels(model);
  if (levels.length === 0) {
    return null;
  }
  return (
    <Select
      aria-label="Effort"
      title="How hard the model thinks"
      className={className}
      disabled={disabled}
      value={value ?? "default"}
      onChange={(ev) => {
        const next = ev.target.value;
        onChange(levels.find((l) => {
          return l === next;
        }));
      }}
    >
      <option value="default">Default effort</option>
      {levels.map((level) => {
        return <option key={level} value={level}>{`Effort: ${level}`}</option>;
      })}
    </Select>
  );
};
