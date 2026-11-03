import { Bold, Braces, Code, Eye, Italic, Link, List, ListOrdered, Pencil, Quote } from "lucide-react";
import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { Markdown } from "@/components/Markdown";
import { MarkdownBackdrop } from "@/components/MarkdownBackdrop";
import { Button } from "@/components/ui/button";
import { codeBlock, continueList, insideFence, link, prefixLines, wrapSelection, type Edit } from "@/lib/markdown-edit";

export const Tool = ({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) => {
  return (
    <Button type="button" variant="subtle" size="icon" className="size-7" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
};

// What the page may set on the box itself: its name for assistive technology, its placeholder, the combobox attributes and the paste handler.
// The editor keeps the value, the keys, the scrolling and the look to itself.
type FieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onKeyDown" | "onScroll" | "onSelect" | "className" | "rows" | "ref">;

// What the page can ask of the editor.
export interface EditorHandle {
  // Puts the selection (or the caret, when both are the same) there once the text has been drawn, as after a choice from a menu.
  select: (start: number, end: number) => void;
}

interface Props {
  text: string;
  preview: boolean;
  onPreview: (value: boolean) => void;
  // The text after a change, and where the caret is when the person typed it (a toolbar or shortcut edit does not say).
  onChange: (value: string, caret?: number) => void;
  onCaret?: (caret: number) => void;
  // Enter outside a code block, or Ctrl or Cmd with Enter anywhere.
  onSubmit: () => void;
  // Offered every key first (menus, Escape); return true when the key was used and the editor should leave it alone.
  before?: (ev: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handle?: Ref<EditorHandle>;
  // Further buttons at the end of the formatting toolbar.
  tools?: ReactNode;
  // Shown between the toolbar and the box, and beside the box.
  above?: ReactNode;
  aside?: ReactNode;
  field?: FieldProps;
}

// The markdown editing shared by the message box and the queued-message editor: the formatting toolbar, the box that grows over several lines
// with the markdown coloured behind it, the Preview toggle, the usual shortcuts (Ctrl or Cmd with B, I, E for code, K for a link), lists that
// carry on, and Enter that adds a line inside a code block instead of submitting. The text itself belongs to the page.
export const MarkdownEditor = ({ text, preview, onPreview, onChange, onCaret, onSubmit, before, handle, tools, above, aside, field }: Props) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The coloured copy of the text behind the box; it follows the box's scrolling.
  const backdrop = useRef<HTMLDivElement>(null);
  // Where the selection should be once the text it belongs to has been drawn.
  const wanted = useRef<{ start: number; end: number } | undefined>(undefined);
  useImperativeHandle(handle, () => {
    return {
      select: (start, end) => {
        wanted.current = { start, end };
      },
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    const place = wanted.current;
    if (el && place) {
      wanted.current = undefined;
      el.focus();
      el.setSelectionRange(place.start, place.end);
    }
    if (el) {
      el.style.height = "auto";
      el.style.height = `${String(Math.min(el.scrollHeight, window.innerHeight * 0.4))}px`;
      if (backdrop.current) {
        backdrop.current.scrollTop = el.scrollTop;
      }
    }
  }, [text, preview]);

  const apply = (next: Edit): void => {
    wanted.current = { start: next.start, end: next.end };
    onChange(next.text);
  };

  // Runs one of the editing functions on the current selection.
  const edit = (make: (value: string, start: number, end: number) => Edit): void => {
    const el = ref.current;
    if (el) {
      apply(make(text, el.selectionStart, el.selectionEnd));
    }
  };

  const keys = (ev: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.nativeEvent.isComposing) {
      return;
    }
    if (before?.(ev) === true) {
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && !ev.shiftKey && !ev.altKey && ev.key !== "Enter") {
      const shortcut: Record<string, (value: string, s: number, e: number) => Edit> = {
        b: (value, s, e) => {
          return wrapSelection(value, s, e, "**");
        },
        i: (value, s, e) => {
          return wrapSelection(value, s, e, "*");
        },
        e: (value, s, e) => {
          return wrapSelection(value, s, e, "`");
        },
        k: link,
      };
      const make = shortcut[ev.key.toLowerCase()];
      if (make) {
        ev.preventDefault();
        edit(make);
      }
      return;
    }
    if (ev.key !== "Enter") {
      return;
    }
    const cursor = ev.currentTarget.selectionStart;
    if (ev.shiftKey) {
      // A new line, which carries a list on.
      const next = continueList(text, cursor);
      if (next) {
        ev.preventDefault();
        apply(next);
      }
      return;
    }
    // Inside a code block Enter adds a line, so code can be typed or pasted without sending half of it; Ctrl or Cmd with Enter sends.
    if (!mod && insideFence(text, cursor)) {
      return;
    }
    ev.preventDefault();
    onSubmit();
  };

  return (
    <>
      <div className="mb-1 flex items-center gap-0.5 border-b pb-1" role="toolbar" aria-label="Formatting">
        <Tool label="Bold" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return wrapSelection(v, s, e, "**");
          });
        }}
        >
          <Bold />
        </Tool>
        <Tool label="Italic" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return wrapSelection(v, s, e, "*");
          });
        }}
        >
          <Italic />
        </Tool>
        <Tool label="Inline code" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return wrapSelection(v, s, e, "`");
          });
        }}
        >
          <Code />
        </Tool>
        <Tool label="Code block" disabled={preview} onClick={() => {
          edit(codeBlock);
        }}
        >
          <Braces />
        </Tool>
        <Tool label="Bulleted list" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return prefixLines(v, s, e, "bullet");
          });
        }}
        >
          <List />
        </Tool>
        <Tool label="Numbered list" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return prefixLines(v, s, e, "number");
          });
        }}
        >
          <ListOrdered />
        </Tool>
        <Tool label="Quote" disabled={preview} onClick={() => {
          edit((v, s, e) => {
            return prefixLines(v, s, e, "quote");
          });
        }}
        >
          <Quote />
        </Tool>
        <Tool label="Link" disabled={preview} onClick={() => {
          edit(link);
        }}
        >
          <Link />
        </Tool>
        {tools}
        <span className="flex-1" />
        <Tool label={preview ? "Edit" : "Preview"} pressed={preview} onClick={() => {
          onPreview(!preview);
        }}
        >
          {preview ? <Pencil /> : <Eye />}
        </Tool>
      </div>

      {above}

      <div className="flex items-end gap-2">
        {preview
          ? (
              <div className="max-h-[40vh] min-h-9 min-w-0 flex-1 overflow-y-auto px-2 py-1.5" aria-label="Preview of your message">
                {text.trim() ? <Markdown text={text} /> : <span className="text-muted-foreground">Nothing to preview yet.</span>}
              </div>
            )
          : (
              <div className="relative min-w-0 flex-1">
                <MarkdownBackdrop text={text} boxRef={backdrop} />
                <textarea
                  {...field}
                  ref={ref}
                  value={text}
                  rows={1}
                  className="relative block max-h-[40vh] min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-transparent caret-foreground outline-none [scrollbar-gutter:stable] selection:bg-primary/30 placeholder:text-muted-foreground forced-colors:text-[CanvasText]"
                  onScroll={(ev) => {
                    if (backdrop.current) {
                      backdrop.current.scrollTop = ev.currentTarget.scrollTop;
                    }
                  }}
                  onChange={(ev) => {
                    onChange(ev.target.value, ev.target.selectionStart);
                  }}
                  onSelect={(ev) => {
                    onCaret?.(ev.currentTarget.selectionStart);
                  }}
                  onKeyDown={keys}
                />
              </div>
            )}
        {aside}
      </div>
    </>
  );
};
