import { cn } from "@/lib/utils";

// A diff in unified hunks: added lines green, removed lines red, hunk headers muted. Long lines wrap rather than scroll.
export const Diff = ({ patch }: { patch: string }) => {
  return (
    <pre className="overflow-hidden rounded-md border bg-muted/40 py-1 font-mono text-xs">
      {patch.split("\n").map((line, i) => {
        return (
          <div key={`${String(i)}-${line.slice(0, 12)}`} className={cn("whitespace-pre-wrap px-2 [overflow-wrap:anywhere]", line.startsWith("+") && "bg-success/15 text-success", line.startsWith("-") && "bg-destructive/15 text-destructive", line.startsWith("@@") && "text-muted-foreground")}>
            {line === "" ? " " : line}
          </div>
        );
      })}
    </pre>
  );
};
