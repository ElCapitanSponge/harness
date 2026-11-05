import { sentTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// When a message was sent, small and muted, in the browser's zone; the full date, time and zone on hover or focus. Nothing when the
// conversation was stored before times were kept, so an old message shows no time rather than a wrong one.
export const SentAt = ({ at, label, className }: { at: number | undefined; label?: string; className?: string }) => {
  const t = sentTime(at);
  if (!t) {
    return null;
  }
  return (
    <time dateTime={t.iso} title={t.full} aria-label={label ? `${label} ${t.full}` : t.full} tabIndex={0} className={cn("shrink-0 whitespace-nowrap rounded text-[11px] font-normal text-muted-foreground", className)}>
      {t.text}
    </time>
  );
};
