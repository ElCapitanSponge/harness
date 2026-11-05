import { useRef, useState } from "react";
import { sentTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// When a message was sent, small and muted, in the browser's zone. It is a button: tabbing to it or tapping it shows the full date, time and zone
// in its place (a phone never shows a tooltip), and the mouse also gets them as a tooltip. Nothing when the conversation was stored before times
// were kept, so an old message shows no time rather than a wrong one.
export const SentAt = ({ at, label, className }: { at: number | undefined; label?: string; className?: string }) => {
  const t = sentTime(at);
  const [full, setFull] = useState(false);
  // A press gives the button focus too; that must not show the full date a second time, then hide it again on the click.
  const pressed = useRef(false);
  if (!t) {
    return null;
  }
  return (
    <button
      type="button"
      title={t.full}
      aria-label={label ? `${label} ${t.full}` : t.full}
      className={cn("shrink-0 rounded text-[11px] font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-2", !full && "whitespace-nowrap", className)}
      onPointerDown={() => {
        pressed.current = true;
      }}
      onFocus={() => {
        if (!pressed.current) {
          setFull(true);
        }
        pressed.current = false;
      }}
      onBlur={() => {
        setFull(false);
      }}
      onClick={() => {
        pressed.current = false;
        setFull((shown) => {
          return !shown;
        });
      }}
    >
      <time dateTime={t.iso}>{full ? t.full : t.text}</time>
    </button>
  );
};
