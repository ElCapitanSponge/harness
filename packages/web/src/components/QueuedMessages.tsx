import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import type { QueuedInfo } from "@harness/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 140)}...` : line;
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
            <li key={m.id} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[13px]">
              <span className="w-4 shrink-0 text-xs text-muted-foreground" aria-hidden>{i + 1}</span>
              {editing?.id === m.id
                ? (
                    <>
                      <Input
                        aria-label={`Reword queued message ${String(i + 1)}`}
                        className="h-7 min-w-0 flex-1 text-[13px]"
                        value={editing.text}
                        autoFocus
                        onChange={(ev) => {
                          setEditing({ id: m.id, text: ev.target.value });
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            save();
                          } else if (ev.key === "Escape") {
                            setEditing(undefined);
                          }
                        }}
                      />
                      <Button type="button" variant="subtle" size="sm" aria-label="Save the change" onClick={save}><Check /></Button>
                      <Button type="button" variant="subtle" size="sm" aria-label="Keep the message as it was" onClick={() => {
                        setEditing(undefined);
                      }}
                      >
                        <X />
                      </Button>
                    </>
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
