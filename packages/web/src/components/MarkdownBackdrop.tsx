import type { RefObject } from "react";
import { highlightMarkdown, type MdKind } from "@/lib/highlight";
import { cn } from "@/lib/utils";

// How each kind of text is drawn. Only colour, background and underline: nothing here may change the width of a letter (no bold or italic faces,
// no other font, no padding), or the coloured copy would drift away from the real text it sits behind.
const LOOK: Record<MdKind, string> = {
  plain: "",
  marker: "text-muted-foreground",
  heading: "text-primary [text-shadow:0_0_0_currentColor]",
  bold: "[text-shadow:0_0_0_currentColor]",
  italic: "text-primary/80 underline decoration-dotted",
  code: "bg-muted",
  link: "text-primary underline",
  quote: "text-muted-foreground",
  fence: "text-muted-foreground",
  fenced: "bg-muted",
};

// The coloured copy of the message that the message box shows through its transparent text. It is only a picture: hidden from assistive
// technology (the box itself holds the text they read), never in the way of the pointer, and it carries the text as text, never as markup.
// It must lay text out exactly as the box does, so it has the same padding and wrapping, and the same scrollbar gutter.
export const MarkdownBackdrop = ({ text, boxRef }: { text: string; boxRef: RefObject<HTMLDivElement | null> }) => {
  return (
    <div
      ref={boxRef}
      aria-hidden
      data-testid="markdown-backdrop"
      className="pointer-events-none absolute inset-0 overflow-y-hidden whitespace-pre-wrap px-2 py-1.5 [overflow-wrap:break-word] [scrollbar-gutter:stable] forced-colors:hidden"
    >
      {highlightMarkdown(text).map((segment, i) => {
        return <span key={`${String(i)}-${segment.kind}`} className={cn(LOOK[segment.kind])}>{segment.text}</span>;
      })}
      {/* A last empty line takes no room unless something follows its line break. */}
      {text.endsWith("\n") ? " " : null}
    </div>
  );
};
