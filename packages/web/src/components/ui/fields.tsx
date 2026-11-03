import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-md border border-input bg-card px-3 text-sm text-card-foreground placeholder:text-muted-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60";

export const Input = ({ className, ...props }: ComponentProps<"input">) => {
  return <input className={cn(field, "h-8 pointer-coarse:h-11", className)} {...props} />;
};

export const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => {
  return <textarea className={cn(field, "min-h-16 py-2", className)} {...props} />;
};

export const Select = ({ className, ...props }: ComponentProps<"select">) => {
  return <select className={cn(field, "h-8 cursor-pointer pr-8 pointer-coarse:h-11", className)} {...props} />;
};

export const Switch = ({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) => {
  return (
    <SwitchPrimitive.Root
      className={cn("relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-input bg-card p-0.5 transition-colors pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-[''] data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-60", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-muted-foreground transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
};

export const Checkbox = ({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) => {
  return (
    <CheckboxPrimitive.Root
      className={cn("relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-card pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-[''] data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-60", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3 text-primary-foreground" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
};

export const Badge = ({ className, tone = "neutral", ...props }: ComponentProps<"span"> & { tone?: "neutral" | "brand" | "success" | "warning" | "danger" }) => {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    brand: "bg-accent text-accent-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-destructive/15 text-destructive",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
};
