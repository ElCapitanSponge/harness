import { INSTRUCTION_LIMIT, instructionFits, type InstructionName } from "@harness/core";
import { BookOpen, FilePlus2, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useInstructionFile, useInstructions, useSaveInstruction } from "@/lib/queries";

// A project's instruction files (AGENTS.md and CLAUDE.md), read and changed from the page. They are read from the session's device when one is
// opened and saved back to it, so what the model is told next turn is what is here. A save is refused if the file changed on the device after
// it was opened; what the person typed stays on the page until they reload or save.

const Editor = ({ id, name, onBack }: { id: string; name: InstructionName; onBack: () => void }) => {
  const file = useInstructionFile(id, name);
  const save = useSaveInstruction(id, name);
  const [draft, setDraft] = useState<string | undefined>();
  // The version the next save is made against: the one the last save gave, until the file is read again.
  const [version, setVersion] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  // A textarea hands its text back with plain line feeds, so the file's is compared the same way.
  const original = file.data?.text.replace(/\r\n/g, "\n") ?? "";
  const text = draft ?? original;
  const changed = draft !== undefined && draft !== original;
  // The device would refuse a text it could not send back whole, so the page does not offer to save one.
  const fits = instructionFits(name, text);
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  const onSave = (): void => {
    if (!file.data) {
      return;
    }
    setSaved(false);
    save.mutate({ text, version: version ?? file.data.version }, {
      onSuccess: (result) => {
        setVersion(result.version);
        setSaved(true);
      },
    });
  };

  const reload = (): void => {
    setDraft(undefined);
    setVersion(undefined);
    setSaved(false);
    save.reset();
    void file.refetch();
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 break-all font-mono text-xs">{name}{file.data && !file.data.exists ? " (new)" : ""}</span>
        <Button variant="subtle" size="sm" onClick={onBack}>Back</Button>
      </div>
      {file.isPending ? <p className="text-[13px] text-muted-foreground" role="status">Reading {name}…</p> : null}
      {file.error ? <p className="text-[13px] text-destructive" role="alert">{file.error.message}</p> : null}
      {file.data
        ? (
            <>
              <textarea
                aria-label={`${name} text`}
                className="min-h-48 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs"
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(false);
                }}
              />
              {fits ? null : <p className="text-[13px] text-destructive" role="alert">This is too long to save from here: the most that can be opened again is about {INSTRUCTION_LIMIT} characters. Shorten it, or edit the file on the device.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!changed || !fits || save.isPending} onClick={onSave}>{save.isPending ? "Saving…" : "Save"}</Button>
                {changed ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
              </div>
            </>
          )
        : null}
      {saved ? <p className="text-[13px] text-success" role="status">Saved. Your next message in this conversation is sent with the new text.</p> : null}
      {save.error
        ? (
            <div className="grid gap-1" role="alert">
              <p className="text-[13px] text-destructive">{save.error.message}</p>
              {conflict
                ? (
                    <>
                      <p className="text-xs text-muted-foreground">Your text is still here. Reloading replaces it with what is on the device.</p>
                      <Button variant="subtle" size="sm" className="w-fit" onClick={reload}>Reload from the device</Button>
                    </>
                  )
                : null}
            </div>
          )
        : null}
    </div>
  );
};

export const ProjectMemory = ({ id }: { id: string }) => {
  const list = useInstructions(id);
  const [open, setOpen] = useState<InstructionName | undefined>();
  const entries = list.data ?? [];
  // Every file answered the same way, such as an older agent or a device that does not allow it: said once, not for each file.
  const firstNote = entries[0]?.note;
  const sharedNote = firstNote !== undefined && entries.every((e) => {
    return e.note === firstNote;
  }) ? firstNote : undefined;
  // Looked at, and not there: only then is the project known to have no instruction file. A file that could not be opened may be there.
  const noneYet = entries.length > 0 && entries.every((e) => {
    return e.exists === false;
  });

  // A conversation with no project folder has no files.
  if (list.data?.length === 0) {
    return null;
  }

  return (
    <section aria-label="Project memory" className="grid gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><BookOpen className="size-4" /> Project memory</h3>
      {open ? (
        <Editor key={open} id={id} name={open} onBack={() => {
          setOpen(undefined);
        }}
        />
      ) : null}
      {open
        ? null
        : (
            <>
              {list.isPending ? <p className="text-[13px] text-muted-foreground" role="status">Looking for instruction files…</p> : null}
              {list.error ? <p className="text-[13px] text-destructive" role="alert">{list.error.message}</p> : null}
              {sharedNote ? <p className="text-[13px] text-muted-foreground">{sharedNote}</p> : null}
              <ul className="grid gap-1">
                {sharedNote ? null : entries.map((e) => {
                  if (e.note) {
                    return (
                      <li key={e.name} className="grid gap-0.5 px-2 py-1.5">
                        <span className="font-mono text-xs">{e.name}</span>
                        <span className="text-[13px] text-muted-foreground">{e.note}</span>
                      </li>
                    );
                  }
                  if (e.exists !== true) {
                    return null;
                  }
                  return (
                    <li key={e.name}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left pointer-coarse:min-h-11 hover:bg-muted" onClick={() => {
                        setOpen(e.name);
                      }}
                      >
                        <FileText className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 break-all font-mono text-xs">{e.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{e.length} characters</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {noneYet ? <p className="text-[13px] text-muted-foreground">This project has no instruction file yet.</p> : null}
              {noneYet
                ? (
                    <Button size="sm" className="w-fit" onClick={() => {
                      setOpen("AGENTS.md");
                    }}
                    >
                      <FilePlus2 /> Create AGENTS.md
                    </Button>
                  )
                : null}
              {list.data && !sharedNote ? <p className="text-xs text-muted-foreground">These tell the model about the project. A change you save applies from your next message.</p> : null}
            </>
          )}
    </section>
  );
};
