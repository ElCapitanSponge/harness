import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive, DropdownMenu as MenuPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = ({ className, children, title, description, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) => {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-raised", className)}
        {...props}
      >
        <div className="grid gap-1">
          <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className={cn("text-muted-foreground", description ? "" : "sr-only")}>{description ?? title}</DialogPrimitive.Description>
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export const MenuContent = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) => {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align="end"
        sideOffset={4}
        className={cn("z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
};

export const MenuItem = ({ className, danger, ...props }: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) => {
  return (
    <MenuPrimitive.Item
      className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4", danger && "text-destructive", className)}
      {...props}
    />
  );
};

// A question that needs a yes or a no. It takes focus on Cancel, closes on Escape, and a click outside does not close it, so a stray tap cannot confirm.
// The caller owns `open`: it stays open while `pending`, and shows `error` if the action failed, until the caller closes it.
export const ConfirmDialog = ({ open, onOpenChange, title, description, confirmLabel, cancelLabel = "Cancel", tone = "plain", pending = false, error, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "plain" | "destructive" | "risky";
  pending?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}) => {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-raised">
          <div className="grid gap-1">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-muted-foreground">{description}</AlertDialogPrimitive.Description>
          </div>
          {error ? <p className="text-destructive" role="alert">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant={tone === "destructive" ? "destructive" : tone === "risky" ? "warning" : "primary"} disabled={pending} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
};
