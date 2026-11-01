import { ArrowUp, Bold, Braces, Code, Eye, Italic, Link, List, ListOrdered, Pencil, Quote, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { codeBlock, continueList, insideFence, link, prefixLines, wrapSelection, type Edit } from "@/lib/markdown-edit";

const read = (name: string): string => {
  try {
    return localStorage.getItem(name) ?? "";
  } catch {
    return "";
  }
};

const write = (name: string, value: string): void => {
  try {
    if (value) {
      localStorage.setItem(name, value);
    } else {
      localStorage.removeItem(name);
    }
  } catch {
    // The draft is only a convenience.
  }
};

const Tool = ({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) => {
  return (
    <Button type="button" variant="subtle" size="icon" className="size-7" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
};

// The message box. It takes markdown: a toolbar and the usual shortcuts (Ctrl or Cmd with B, I, E for code, K for a link), lists
// that carry on, a live preview, and Enter that adds a line inside a code block instead of sending. What was typed and not sent
// is kept for each conversation, so a refresh does not lose it.
export const Composer = ({ draftKey, busy, disabled, placeholder, onSend, onStop }: { draftKey: string; busy: boolean; disabled?: boolean; placeholder?: string; onSend: (text: string) => void; onStop?: () => void }) => {
  const name = `harness-draft-${draftKey}`;
  const [text, setText] = useState(() => {
    return read(name);
  });
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the selection should be once the text it belongs to has been drawn.
  const selection = useRef<{ start: number; end: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    const wanted = selection.current;
    if (el && wanted) {
      selection.current = undefined;
      el.focus();
      el.setSelectionRange(wanted.start, wanted.end);
    }
    if (el) {
      el.style.height = "auto";
      el.style.height = `${String(Math.min(el.scrollHeight, window.innerHeight * 0.4))}px`;
    }
  }, [text, preview]);

  const change = (value: string): void => {
    setText(value);
    write(name, value);
  };

  const apply = (edit: Edit): void => {
    selection.current = { start: edit.start, end: edit.end };
    change(edit.text);
  };

  // Runs one of the editing functions on the current selection.
  const edit = (make: (value: string, start: number, end: number) => Edit): void => {
    const el = ref.current;
    if (el) {
      apply(make(text, el.selectionStart, el.selectionEnd));
    }
  };

  const submit = (): void => {
    const value = text.trim();
    if (!value || busy || disabled) {
      return;
    }
    write(name, "");
    setText("");
    setPreview(false);
    onSend(value);
  };

  const keys = (ev: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.nativeEvent.isComposing) {
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
    submit();
  };

  const busyWithText = busy || (disabled ?? false);

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={(ev: SyntheticEvent) => {
        ev.preventDefault();
        submit();
      }}
    >
      <div className="rounded-2xl border border-input bg-card p-2 shadow-card focus-within:border-primary">
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
          <span className="flex-1" />
          <Tool label={preview ? "Edit" : "Preview"} pressed={preview} onClick={() => {
            setPreview(!preview);
          }}
          >
            {preview ? <Pencil /> : <Eye />}
          </Tool>
        </div>

        <div className="flex items-end gap-2">
          {preview
            ? (
                <div className="max-h-[40vh] min-h-9 min-w-0 flex-1 overflow-y-auto px-2 py-1.5" aria-label="Preview of your message">
                  {text.trim() ? <Markdown text={text} /> : <span className="text-muted-foreground">Nothing to preview yet.</span>}
                </div>
              )
            : (
                <textarea
                  ref={ref}
                  value={text}
                  rows={1}
                  aria-label="Message"
                  placeholder={placeholder ?? "Message (markdown works)"}
                  className="max-h-[40vh] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted-foreground"
                  onChange={(ev) => {
                    change(ev.target.value);
                  }}
                  onKeyDown={keys}
                />
              )}
          {busy && onStop
            ? (
                <Button type="button" variant="secondary" size="icon" onClick={onStop} aria-label="Stop">
                  <Square className="fill-current" />
                </Button>
              )
            : (
                <Button type="submit" variant="primary" size="icon" disabled={busyWithText || !text.trim()} aria-label="Send">
                  <ArrowUp />
                </Button>
              )}
        </div>
      </div>
      <p className="mt-1 px-2 text-xs text-muted-foreground">Enter sends. Shift+Enter adds a line. Inside a code block Enter adds a line and Ctrl+Enter sends.</p>
    </form>
  );
};
