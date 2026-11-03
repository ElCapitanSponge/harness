import { Download, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { ConfirmDialog, Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { downloadExport } from "@/lib/download";
import { useDeleteConversation, usePinConversation, useRenameConversation } from "@/lib/queries";
import type { SessionInfo } from "@/lib/types";

// Rename and delete for one conversation, from a small menu.
export const ConversationActions = ({ info, onDeleted, className }: { info: SessionInfo; onDeleted?: () => void; className?: string }) => {
  const [dialog, setDialog] = useState<"rename" | "delete" | undefined>();
  const [title, setTitle] = useState(info.title);
  const rename = useRenameConversation();
  const remove = useDeleteConversation();
  const pin = usePinConversation();

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="subtle" size="icon" className={className} aria-label="Conversation actions">
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => {
            pin.mutate({ id: info.id, pinned: info.pinned !== true });
          }}
          >
            {info.pinned === true ? <PinOff /> : <Pin />} {info.pinned === true ? "Unpin" : "Pin to top"}
          </MenuItem>
          <MenuItem onSelect={() => {
            setTitle(info.title);
            setDialog("rename");
          }}
          >
            <Pencil /> Rename
          </MenuItem>
          <MenuItem onSelect={() => {
            void downloadExport(info.id, info.title);
          }}
          >
            <Download /> Export as markdown
          </MenuItem>
          <MenuItem danger onSelect={() => {
            setDialog("delete");
          }}
          >
            <Trash2 /> Delete
          </MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={dialog === "rename"} onOpenChange={(open) => {
        setDialog(open ? "rename" : undefined);
      }}
      >
        <DialogContent title="Rename conversation">
          <form
            className="grid gap-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (title.trim()) {
                rename.mutate({ id: info.id, title: title.trim() }, { onSuccess: () => {
                  setDialog(undefined);
                } });
              }
            }}
          >
            <Input value={title} maxLength={120} autoFocus aria-label="Title" onChange={(ev) => {
              setTitle(ev.target.value);
            }}
            />
            {rename.error ? <p className="text-destructive" role="alert">{rename.error.message}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => {
                setDialog(undefined);
              }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!title.trim() || rename.isPending}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          setDialog(open ? "delete" : undefined);
        }}
        title="Delete this conversation?"
        description="Its history is removed from the gateway and cannot be brought back."
        confirmLabel="Delete"
        tone="destructive"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => {
          remove.mutate(info.id, { onSuccess: () => {
            setDialog(undefined);
            onDeleted?.();
          } });
        }}
      />
    </>
  );
};
