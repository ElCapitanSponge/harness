import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Fluent 2 buttons: 4px corners, a filled brand button for the main action, outlined and subtle for the rest. On a touchscreen
// (pointer-coarse) every size is 44px tall, and an icon button 44px square; a caller's own smaller size only applies to a mouse.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        secondary: "border border-input bg-card text-card-foreground hover:bg-muted active:bg-border",
        subtle: "text-foreground hover:bg-muted active:bg-border",
        destructive: "bg-destructive text-white hover:opacity-90",
        warning: "bg-warning text-background hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 pointer-coarse:h-11",
        sm: "h-7 px-2 text-xs pointer-coarse:h-11",
        lg: "h-10 px-4 pointer-coarse:h-11",
        icon: "size-8 pointer-coarse:size-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export const Button = ({ className, variant, size, asChild = false, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) => {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
};
