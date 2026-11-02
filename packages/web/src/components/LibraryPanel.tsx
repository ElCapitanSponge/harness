import { Download, FolderUp, Library, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/fields";
import { ApiError } from "@/lib/api";
import { downloadSkill } from "@/lib/download";
import { useAddLibrarySkill, useLibrary, useRemoveLibrarySkill } from "@/lib/queries";
import { readSkillUpload, type SkillUpload } from "@/lib/skillfiles";

const size = (bytes: number): string => {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${String(bytes)} bytes`;
};

// The gateway's own skills: available in every conversation, including chats with no device. Add a skill from a zip or a folder, export
// one as a zip (the layout other tools take), or remove it.
export const LibraryPanel = () => {
  const library = useLibrary();
  const add = useAddLibrarySkill();
  const remove = useRemoveLibrarySkill();
  const zip = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  // A skill that clashed with one already there, held so it can be added again as a replacement.
  const [clash, setClash] = useState<{ upload: SkillUpload; message: string } | undefined>();

  const send = async (upload: SkillUpload, overwrite: boolean): Promise<void> => {
    setError("");
    setClash(undefined);
    try {
      await add.mutateAsync({ ...upload, ...(overwrite ? { overwrite: true } : {}) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setClash({ upload, message: err.message });
      } else {
        setError(err instanceof Error ? err.message : "Could not add that skill.");
      }
    }
  };

  const choose = async (files: File[]): Promise<void> => {
    setError("");
    setClash(undefined);
    try {
      await send(await readSkillUpload(files), false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that.");
    }
  };

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-card" aria-label="Library">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold"><Library className="size-4 shrink-0" /> Library <span className="font-normal text-muted-foreground">on the gateway</span></h2>
        <input
          ref={zip}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          aria-label="Choose a skill zip"
          onChange={(ev) => {
            const chosen = [...(ev.target.files ?? [])];
            ev.target.value = "";
            void choose(chosen);
          }}
        />
        <input
          ref={folder}
          type="file"
          className="sr-only"
          aria-label="Choose a skill folder"
          multiple
          {...{ webkitdirectory: "" }}
          onChange={(ev) => {
            const chosen = [...(ev.target.files ?? [])];
            ev.target.value = "";
            void choose(chosen);
          }}
        />
        <Button size="sm" disabled={add.isPending} onClick={() => {
          zip.current?.click();
        }}
        >
          <Upload /> Add a zip
        </Button>
        <Button size="sm" disabled={add.isPending} onClick={() => {
          folder.current?.click();
        }}
        >
          <FolderUp /> Add a folder
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">Available in every conversation, including chats with no device. A skill that needs files or commands says so when used in a chat.</p>

      {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      {clash
        ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-[13px]" role="alert">
              <span className="min-w-0 flex-1">{clash.message}</span>
              <Button size="sm" variant="primary" onClick={() => {
                void send(clash.upload, true);
              }}
              >
                Replace it
              </Button>
              <Button size="sm" variant="subtle" onClick={() => {
                setClash(undefined);
              }}
              >
                Keep the old one
              </Button>
            </div>
          )
        : null}

      {library.data?.length === 0 ? <p className="text-[13px] text-muted-foreground">The library is empty.</p> : null}
      {library.data && library.data.length > 0
        ? (
            <ul className="grid divide-y rounded-lg border" aria-label="Library skills">
              {library.data.map((s) => {
                return (
                  <li key={s.name} className="grid gap-0.5 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sparkles className="size-4 shrink-0 text-primary" />
                      <span className="font-semibold">/{s.name}</span>
                      {s.hint ? <span className="text-xs text-muted-foreground">{s.hint}</span> : null}
                      <span className="flex-1" />
                      {s.modelInvocable ? null : <Badge tone="warning">you start it</Badge>}
                      <span className="text-xs text-muted-foreground">{s.files} file{s.files === 1 ? "" : "s"}, {size(s.bytes)}</span>
                      <Button variant="subtle" size="icon" className="size-7" aria-label={`Export ${s.name} as a zip`} onClick={() => {
                        void downloadSkill(s.name);
                      }}
                      >
                        <Download />
                      </Button>
                      <Button variant="subtle" size="icon" className="size-7" aria-label={`Remove ${s.name} from the library`} onClick={() => {
                        remove.mutate(s.name);
                      }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>
                  </li>
                );
              })}
            </ul>
          )
        : null}
    </section>
  );
};
