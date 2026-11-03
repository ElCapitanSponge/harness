import { ChevronRight, FileText, Folder, FolderUp, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deviceTool as call, plainText } from "@/lib/devicefiles";

// Browses a coding session's project folder on its device, read-only, and adds a file's text to the message being written. It asks the
// device through the same read-only tool route the command line uses, so it sees only what the device exposes to sessions.

export { plainText } from "@/lib/devicefiles";

export const parentOf = (dir: string): string => {
  const parts = dir.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

export const FileBrowser = ({ device, root, onAdd }: { device: string; root: string; onAdd: (path: string, text: string, shortened: boolean) => void }) => {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<string[] | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (next: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const output = await call(device, root, "list_dir", { path: next === "" ? "." : next });
      setEntries(output === "(empty)" ? [] : output.split("\n").filter((l) => {
        return l !== "" && !l.startsWith("[...");
      }));
      setDir(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that folder.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (file: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const { text, shortened } = plainText(await call(device, root, "read_file", { path: file }));
      onAdd(file, text, shortened);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Files on the device" className="grid gap-1">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Folder className="size-4" /> Files in {root}</h3>
      {entries === undefined
        ? (
            <Button size="sm" className="w-fit" disabled={busy} onClick={() => {
              void open("");
            }}
            >
              Browse {root}
            </Button>
          )
        : (
            <>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronRight className="size-3" />
                <span className="break-all font-mono">{dir === "" ? "/" : `/${dir}`}</span>
                {dir !== ""
                  ? (
                      <Button variant="subtle" size="icon" className="ml-auto size-6" aria-label="Up one folder" disabled={busy} onClick={() => {
                        void open(parentOf(dir));
                      }}
                      >
                        <FolderUp />
                      </Button>
                    )
                  : null}
              </div>
              {entries.length === 0 ? <p className="text-[13px] text-muted-foreground">This folder is empty.</p> : null}
              <ul className="grid gap-0.5">
                {entries.map((name) => {
                  const isDir = name.endsWith("/");
                  const clean = isDir ? name.slice(0, -1) : name;
                  const path = dir === "" ? clean : `${dir}/${clean}`;
                  return (
                    <li key={name} className="flex items-center gap-1">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left pointer-coarse:min-h-11 hover:bg-muted" disabled={busy} onClick={() => {
                        if (isDir) {
                          void open(path);
                        } else {
                          void add(path);
                        }
                      }}
                      >
                        {isDir ? <Folder className="size-4 shrink-0 text-primary" /> : <FileText className="size-4 shrink-0" />}
                        <span className="min-w-0 flex-1 break-all text-[13px]">{name}</span>
                      </button>
                      {isDir ? null : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">Choose a file to add its text to your message.</p>
            </>
          )}
      {error ? <p className="text-[13px] text-destructive" role="alert">{error}</p> : null}
    </section>
  );
};
