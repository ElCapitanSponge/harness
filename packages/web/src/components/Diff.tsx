import { parseDiff } from "@/lib/diff";
import { cn } from "@/lib/utils";

// A line number in the gutter. Not selectable and hidden from screen readers, so copying a diff copies the code and nothing else.
const Gutter = ({ n }: { n: number | undefined }) => {
  return <span aria-hidden className="w-9 shrink-0 select-none px-1 text-right tabular-nums text-muted-foreground/70">{n}</span>;
};

// A diff in unified hunks: the old and new line numbers in a gutter, added lines green, removed lines red, hunk headers muted. Long lines
// wrap rather than scroll.
export const Diff = ({ patch, className }: { patch: string; className?: string }) => {
  return (
    <pre className={cn("overflow-hidden rounded-md border bg-muted/40 py-1 font-mono text-xs", className)}>
      {parseDiff(patch).map((row, i) => {
        return (
          <div key={`${String(i)}-${row.text.slice(0, 12)}`} className={cn("flex", row.kind === "add" && "bg-success/15", row.kind === "del" && "bg-destructive/15")}>
            <Gutter n={row.old} />
            <Gutter n={row.new} />
            <span className={cn("min-w-0 flex-1 whitespace-pre-wrap px-2 [overflow-wrap:anywhere]", row.kind === "add" && "text-success", row.kind === "del" && "text-destructive", (row.kind === "hunk" || row.kind === "meta") && "text-muted-foreground")}>
              {row.text === "" ? " " : row.text}
            </span>
          </div>
        );
      })}
    </pre>
  );
};
