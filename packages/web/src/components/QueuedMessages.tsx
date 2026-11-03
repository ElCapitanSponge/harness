import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import type { QueuedInfo } from "@harness/core";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 140)}...` : line;
};

// Rewording one queued message with the same editing as the message box: the toolbar, the markdown coloured as it is written, the shortcuts,
// a box that grows over several lines, and the preview. Enter saves, as Enter sends in the box; Shift+Enter adds a line and Escape keeps the
// message as it was. Pictures on the message stay as they were queued.
const QueuedEditor = ({ label, text, onChange, onSave, onCancel }: { label: string; text: string; onChange: (text: string) => void; onSave: () => void; onCancel: () => void }) => {
  const [preview, setPreview] = useState(false);
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-input bg-card p-1.5 focus-within:border-primary">
      <MarkdownEditor
        text={text}
        preview={preview}
        onPreview={setPreview}
        onChange={(value) => {
          onChange(value);
        }}
        onSubmit={onSave}
        before={(ev) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            onCancel();
            return true;
          }
          return false;
        }}
        aside={(
          <>
            <Button type="button" variant="subtle" size="sm" aria-label="Save the change" onClick={onSave}><Check /></Button>
            <Button type="button" variant="subtle" size="sm" aria-label="Keep the message as it was" onClick={onCancel}>
              <X />
            </Button>
          </>
        )}
        field={{ "aria-label": label, "autoFocus": true }}
      />
      <p className="mt-1 px-1 text-xs text-muted-foreground">Enter saves. Shift+Enter adds a line. Escape keeps it as it was.</p>
    </div>
  );
};

// Messages sent while the model was working, above the message box in the order they will be taken up. The gateway keeps them, so this shows the
// same list in every client. Each can be reworded, taken back, or sent now (which stops the turn that is running).
export const QueuedMessages = ({ messages, held, onEdit, onRemove, onSendNow }: { messages: QueuedInfo[]; held: boolean; onEdit: (id: string, text: string) => void; onRemove: (id: string) => void; onSendNow: (id: string) => void }) => {
  const [editing, setEditing] = useState<{ id: string; text: string } | undefined>();
  if (messages.length === 0) {
    return null;
  }
  const save = (): void => {
    if (editing && editing.text.trim() !== "") {
      onEdit(editing.id, editing.text.trim());
      setEditing(undefined);
    }
  };
  return (
    <section aria-label="Queued messages" className="mx-auto grid w-full max-w-3xl gap-1 px-4 pb-1.5">
      <p className="text-xs text-muted-foreground" role={held ? "status" : undefined}>
        {held
          ? "Held: the last turn did not finish, so these have not been sent. They go on after the next turn that finishes. Send one now to start it at once, or remove it."
          : `Waiting for the model to finish (${String(messages.length)}):`}
      </p>
      <ol className="grid gap-1">
        {messages.map((m, i) => {
          return (
            <li key={m.id} className={cn("flex gap-1.5 rounded-md border bg-card px-2 py-1 text-[13px]", editing?.id === m.id ? "items-start" : "items-center")}>
              <span className={cn("w-4 shrink-0 text-xs text-muted-foreground", editing?.id === m.id && "pt-2")} aria-hidden>{i + 1}</span>
              {editing?.id === m.id
                ? (
                    <QueuedEditor
                      label={`Reword queued message ${String(i + 1)}`}
                      text={editing.text}
                      onChange={(text) => {
                        setEditing({ id: m.id, text });
                      }}
                      onSave={save}
                      onCancel={() => {
                        setEditing(undefined);
                      }}
                    />
                  )
                : (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {clip(m.text)}
                        {m.images > 0 ? <span className="ml-1 text-xs text-muted-foreground">({String(m.images)} image{m.images === 1 ? "" : "s"})</span> : null}
                      </span>
                      <Button type="button" variant="subtle" size="sm" onClick={() => {
                        onSendNow(m.id);
                      }}
                      >
                        Send now
                        <span className="sr-only">: {clip(m.text)}</span>
                      </Button>
                      <Button type="button" variant="subtle" size="sm" aria-label={`Edit queued message ${String(i + 1)}`} onClick={() => {
                        setEditing({ id: m.id, text: m.text });
                      }}
                      >
                        <Pencil />
                      </Button>
                      <Button type="button" variant="subtle" size="sm" aria-label={`Remove queued message ${String(i + 1)}`} onClick={() => {
                        onRemove(m.id);
                      }}
                      >
                        <X />
                      </Button>
                    </>
                  )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
