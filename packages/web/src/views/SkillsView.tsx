import { FileText, Sparkles, TriangleAlert } from "lucide-react";
import { useSkills } from "@/lib/queries";
import type { SkillsFolder } from "@/lib/types";
import { LibraryPanel } from "@/components/LibraryPanel";
import { Badge } from "@/components/ui/fields";

const size = (characters: number): string => {
  return characters >= 1000 ? `${(characters / 1000).toFixed(1)}k characters` : `${String(characters)} characters`;
};

const Folder = ({ folder }: { folder: SkillsFolder }) => {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-card" aria-label={`${folder.device}: ${folder.root}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{folder.device}<span className="font-normal text-muted-foreground"> : {folder.root}</span></h2>
        <Badge tone="neutral">{folder.skills.length} skill{folder.skills.length === 1 ? "" : "s"}</Badge>
      </div>

      {folder.note ? <p className="text-[13px] text-muted-foreground">This device could not list its skills: {folder.note}</p> : null}

      {folder.instructions.length > 0
        ? (
            <ul className="grid gap-1" aria-label="Instruction files">
              {folder.instructions.map((i) => {
                return (
                  <li key={i.source} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <FileText className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{i.source}</span>
                    <span>{size(i.length)}</span>
                  </li>
                );
              })}
            </ul>
          )
        : null}

      {folder.skills.length > 0
        ? (
            <ul className="grid divide-y rounded-lg border" aria-label="Skills">
              {folder.skills.map((s) => {
                return (
                  <li key={s.name} className="grid gap-0.5 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sparkles className="size-4 shrink-0 text-primary" />
                      <span className="font-semibold">/{s.name}</span>
                      {s.hint ? <span className="text-xs text-muted-foreground">{s.hint}</span> : null}
                      <span className="flex-1" />
                      <Badge tone="neutral">{s.source === "user" ? "yours" : "project"}</Badge>
                      {s.modelInvocable ? null : <Badge tone="warning">you start it</Badge>}
                      <span className="text-xs text-muted-foreground">{size(s.length)}</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{s.description}</p>
                  </li>
                );
              })}
            </ul>
          )
        : null}

      {folder.skipped.length > 0
        ? (
            <div className="grid gap-1" role="group" aria-label="Skipped skills">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <TriangleAlert className="size-4 text-destructive" /> Skipped
              </div>
              <ul className="grid gap-1">
                {folder.skipped.map((s) => {
                  return (
                    <li key={s.path} className="rounded-md bg-muted px-3 py-1.5 text-[13px]">
                      <div className="break-all font-mono text-xs">{s.path}</div>
                      <div className="text-muted-foreground">{s.reason}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        : null}

      {folder.skills.length === 0 && folder.skipped.length === 0 && !folder.note ? <p className="text-[13px] text-muted-foreground">No skills found here.</p> : null}
    </section>
  );
};

// Every skill each device finds in each project folder it exposes, how long each is, and any that were skipped and why. Type / in a
// coding conversation to run one.
export const SkillsView = () => {
  const skills = useSkills();
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Skills</h1>
          <p className="text-muted-foreground">The gateway's library, and what each device offers in each project folder. Type / in a conversation to run one; the model can start the others itself.</p>
        </div>
        <LibraryPanel />
        {skills.isPending ? <p className="text-muted-foreground">Loading...</p> : null}
        {skills.isError ? <p className="text-destructive" role="alert">Could not load the skills.</p> : null}
        {skills.data?.length === 0 ? <p className="text-muted-foreground">No device with a project folder is connected.</p> : null}
        {skills.data?.map((folder) => {
          return <Folder key={`${folder.device}/${folder.root}`} folder={folder} />;
        })}
      </div>
    </div>
  );
};
