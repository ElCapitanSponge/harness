import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { type ComponentProps, useId } from "react";
import { Badge } from "@/components/ui/fields";
import { cn } from "@/lib/utils";

export interface ChoiceOption {
  value: string;
  label: string;
  // The second line, shown in the list only: what the option means, or why it cannot be chosen.
  detail?: string;
  badge?: string;
  badgeTone?: ComponentProps<typeof Badge>["tone"];
  disabled?: boolean;
}

export interface ChoiceGroup {
  label?: string;
  options: ChoiceOption[];
}

const Row = ({ option }: { option: ChoiceOption }) => {
  const detailId = useId();
  return (
    <SelectPrimitive.Item
      value={option.value}
      disabled={option.disabled ?? false}
      aria-describedby={option.detail ? detailId : undefined}
      className="relative flex min-h-11 cursor-pointer select-none items-start gap-2 rounded-md py-2 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-muted data-[state=checked]:font-medium data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 sm:min-h-0 sm:py-1.5"
    >
      <span className="absolute left-2 top-2.5 flex size-4 items-center justify-center sm:top-2">
        <SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator>
      </span>
      <span className="grid min-w-0 flex-1 break-words">
        <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
        {option.detail ? <span id={detailId} className="text-xs font-normal text-muted-foreground">{option.detail}</span> : null}
      </span>
      {option.badge ? <Badge tone={option.badgeTone ?? "neutral"}>{option.badge}</Badge> : null}
    </SelectPrimitive.Item>
  );
};

// Pick one of a few options that need explaining. The button shows only the chosen label; the list gives each option a second line
// (what it means, or why it cannot be chosen) and an optional badge, so nothing hides in a tooltip a phone never shows. Plain lists
// (a device, a folder) stay a native select, which phones show with the system picker.
export const Choice = ({ label, groups, value, onValueChange, disabled = false, className }: { label: string; groups: ChoiceGroup[]; value: string; onValueChange: (value: string) => void; disabled?: boolean; className?: string }) => {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn("flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-card-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60", className)}
      >
        <span className="min-w-0 truncate"><SelectPrimitive.Value /></span>
        <SelectPrimitive.Icon asChild><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] max-w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-raised"
        >
          <SelectPrimitive.Viewport className="max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-y-auto p-1">
            {groups.map((group) => {
              return (
                <SelectPrimitive.Group key={group.label ?? group.options[0]?.value ?? ""}>
                  {group.label ? <SelectPrimitive.Label className="px-2 py-1 text-xs font-semibold text-muted-foreground">{group.label}</SelectPrimitive.Label> : null}
                  {group.options.map((option) => {
                    return <Row key={option.value} option={option} />;
                  })}
                </SelectPrimitive.Group>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
};
