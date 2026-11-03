import { ArrowUp, Bold, Braces, Code, Eye, Italic, Link, List, ListOrdered, FileText, Paperclip, Pencil, Quote, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { Markdown } from "@/components/Markdown";
import { MarkdownBackdrop } from "@/components/MarkdownBackdrop";
import { Button } from "@/components/ui/button";
import { codeBlock, continueList, insideFence, link, prefixLines, wrapSelection, type Edit } from "@/lib/markdown-edit";
import type { ImageAttachment } from "@harness/core/image";
import { contextBlock, desktopApi, type PickedFile } from "@/lib/desktop";
import { pickInBrowser } from "@/lib/pickfiles";
import { readImages } from "@/lib/images";
import { matchSkills, slashQuery } from "@/lib/skills";
import { asSkillInfo, BUILTIN_COMMANDS, isCommand, parseCommand } from "@/lib/commands";
import { applyMention, type Candidate } from "@/lib/mentions";
import type { SkillInfo } from "@/lib/types";
import { readProjectFile, useMention, type Project } from "@/lib/useMention";
import { cn } from "@/lib/utils";

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
export const Composer = ({ draftKey, busy, disabled, placeholder, skills, imageNote, insertion, project, onCommand, onSend, onStop, canQueue }: { draftKey: string; busy: boolean; canQueue?: boolean; disabled?: boolean; placeholder?: string; skills?: SkillInfo[]; imageNote?: string; insertion?: { id: number; text: string }; project?: Project; onCommand?: (name: string, args: string) => void; onSend: (text: string, images?: ImageAttachment[]) => void; onStop?: () => void }) => {
  const name = `harness-draft-${draftKey}`;
  const [text, setText] = useState(() => {
    return read(name);
  });
  const [preview, setPreview] = useState(false);
  // Pictures to go with the message. Only offered where the page passes `imageNote` (a coding session or chat that can take them).
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [imageProblems, setImageProblems] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const imagesAllowed = imageNote !== undefined;
  // The slash menu: typing / first lists the skills; the arrows move, Enter or Tab completes the name, Escape closes it.
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = slashQuery(text);
  // The built-in commands are listed first, then the skills, when the page can run commands.
  const listed = onCommand ? [...BUILTIN_COMMANDS.map(asSkillInfo), ...(skills ?? [])] : skills;
  const matches = query !== undefined && listed ? matchSkills(listed, query) : [];
  const menu = matches.length > 0 && !dismissed && !preview;
  const chosen = Math.min(active, Math.max(0, matches.length - 1));
  const ref = useRef<HTMLTextAreaElement>(null);
  // The coloured copy of the text behind the box; it follows the box's scrolling.
  const backdrop = useRef<HTMLDivElement>(null);
  // The @ menu: in a coding session, typing @ and a name lists the project's files; choosing one puts its path in the message and its text
  // below as context. The slash menu has the message when it starts with /.
  const [caret, setCaret] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const found = useMention(project, text, caret, !menu && !preview);
  const mentionOpen = found.mention !== undefined && found.candidates.length > 0 && !mentionDismissed;
  const mentionChosen = Math.min(mentionActive, Math.max(0, found.candidates.length - 1));
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
      if (backdrop.current) {
        backdrop.current.scrollTop = el.scrollTop;
      }
    }
  }, [text, preview]);

  // Files added as context: from the panel (insertion), or chosen here with the system's file picker in the desktop app (any file on this
  // machine), or the browser's. Their text goes into the message in a code block with its path.
  const [contextProblems, setContextProblems] = useState<string[]>([]);
  const lastInsertion = useRef(0);
  const append = (block: string): void => {
    setText((current) => {
      const next = `${current}${current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;
      write(name, next);
      return next;
    });
  };
  useEffect(() => {
    if (insertion && insertion.id !== lastInsertion.current) {
      lastInsertion.current = insertion.id;
      append(insertion.text);
    }
  });
  const addFiles = async (): Promise<void> => {
    setContextProblems([]);
    const desktop = desktopApi();
    const picked: PickedFile[] = desktop ? await desktop.pickFiles() : await pickInBrowser();
    const problems: string[] = [];
    for (const file of picked) {
      if (file.content === undefined) {
        problems.push(file.problem ?? `Could not read ${file.name}.`);
      } else {
        append(contextBlock(file.path, file.content));
      }
    }
    setContextProblems(problems);
  };

  const change = (value: string): void => {
    setActive(0);
    setDismissed(false);
    setMentionActive(0);
    setMentionDismissed(false);
    setText(value);
    write(name, value);
  };

  // Choosing from the slash menu completes the name for the person to go on. A command is run at once when it takes nothing more, or when
  // its whole name has already been typed.
  const chooseSlash = (pick: SkillInfo): void => {
    if (onCommand && isCommand(pick) && (!pick.hint || text.trim() === `/${pick.name}`)) {
      write(name, "");
      setText("");
      onCommand(pick.name, "");
      return;
    }
    change(`/${pick.name} `);
    selection.current = { start: pick.name.length + 2, end: pick.name.length + 2 };
  };

  const chooseMention = (choice: Candidate): void => {
    if (!found.mention) {
      return;
    }
    const next = applyMention(text, found.mention, choice);
    selection.current = { start: next.caret, end: next.caret };
    setCaret(next.caret);
    change(next.text);
    if (!choice.isDir && project) {
      setContextProblems([]);
      void readProjectFile(project, choice.path).then((file) => {
        if (file.ok) {
          append(contextBlock(`${file.path}${file.shortened ? " (shortened)" : ""}`, file.text));
        } else {
          setContextProblems([file.problem]);
        }
      });
    }
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

  const attach = async (files: File[]): Promise<void> => {
    if (!imagesAllowed || files.length === 0) {
      return;
    }
    const read = await readImages(files, images.length);
    setImages((current) => {
      return [...current, ...read.images];
    });
    setImageProblems(read.problems);
  };

  const submit = (): void => {
    const value = text.trim();
    if (!value || (busy && !canQueue) || disabled) {
      return;
    }
    const command = onCommand ? parseCommand(value) : undefined;
    if (command && onCommand) {
      write(name, "");
      setText("");
      setPreview(false);
      onCommand(command.name, command.args);
      return;
    }
    write(name, "");
    setText("");
    setPreview(false);
    const sending = images;
    setImages([]);
    setImageProblems([]);
    if (sending.length > 0) {
      onSend(value, sending);
    } else {
      onSend(value);
    }
  };

  const keys = (ev: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.nativeEvent.isComposing) {
      return;
    }
    if (mentionOpen) {
      const pick = found.candidates[mentionChosen];
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setMentionActive((mentionChosen + (ev.key === "ArrowDown" ? 1 : found.candidates.length - 1)) % found.candidates.length);
        return;
      }
      if ((ev.key === "Enter" || ev.key === "Tab") && pick && !ev.shiftKey) {
        ev.preventDefault();
        chooseMention(pick);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (menu) {
      const pick = matches[chosen];
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setActive((chosen + (ev.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if ((ev.key === "Enter" || ev.key === "Tab") && pick && !ev.shiftKey) {
        ev.preventDefault();
        chooseSlash(pick);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setDismissed(true);
        return;
      }
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

  // With a queue, a turn running does not stop the person sending: the message waits its turn.
  const busyWithText = (busy && !canQueue) || (disabled ?? false);

  return (
    <form
      className="relative mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={(ev: SyntheticEvent) => {
        ev.preventDefault();
        submit();
      }}
      onDragOver={(ev) => {
        if (imagesAllowed) {
          ev.preventDefault();
        }
      }}
      onDrop={(ev) => {
        if (imagesAllowed) {
          ev.preventDefault();
          void attach([...ev.dataTransfer.files]);
        }
      }}
    >
      {mentionOpen
        ? (
            <ul id={`${name}-files`} role="listbox" aria-label="Project files" className="absolute inset-x-4 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-xl border bg-card p-1 shadow-card">
              {found.candidates.map((c, i) => {
                return (
                  <li
                    key={c.path}
                    id={`${name}-file-${c.path}`}
                    role="option"
                    aria-selected={i === mentionChosen}
                    className={cn("cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[13px]", i === mentionChosen && "bg-accent text-accent-foreground")}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      chooseMention(c);
                    }}
                  >
                    {c.path}
                  </li>
                );
              })}
            </ul>
          )
        : null}
      {menu
        ? (
            <ul id={`${name}-skills`} role="listbox" aria-label="Skills" className="absolute inset-x-4 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-xl border bg-card p-1 shadow-card">
              {matches.map((s, i) => {
                return (
                  <li
                    key={s.name}
                    id={`${name}-skill-${s.name}`}
                    role="option"
                    aria-selected={i === chosen}
                    className={cn("cursor-pointer rounded-lg px-3 py-1.5", i === chosen && "bg-accent text-accent-foreground")}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      chooseSlash(s);
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">/{s.name}</span>
                      {isCommand(s) ? <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">command</span> : null}
                      {s.hint ? <span className="text-xs text-muted-foreground">{s.hint}</span> : null}
                    </div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
                  </li>
                );
              })}
            </ul>
          )
        : null}
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
          {imagesAllowed
            ? (
                <>
                  <input ref={picker} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" aria-label="Choose images" onChange={(ev) => {
                    const chosen = [...(ev.target.files ?? [])];
                    ev.target.value = "";
                    void attach(chosen);
                  }}
                  />
                  <Tool label="Add files as context" disabled={preview} onClick={() => {
                    void addFiles();
                  }}
                  >
                    <FileText />
                  </Tool>
                  <Tool label="Attach an image" disabled={preview} onClick={() => {
                    picker.current?.click();
                  }}
                  >
                    <Paperclip />
                  </Tool>
                </>
              )
            : null}
          <span className="flex-1" />
          <Tool label={preview ? "Edit" : "Preview"} pressed={preview} onClick={() => {
            setPreview(!preview);
          }}
          >
            {preview ? <Pencil /> : <Eye />}
          </Tool>
        </div>

        {images.length > 0
          ? (
              <ul className="mb-1 flex flex-wrap gap-2" aria-label="Attached images">
                {images.map((img, i) => {
                  return (
                    <li key={`${String(i)}-${img.data.slice(-12)}`} className="relative">
                      <img src={`data:${img.mediaType};base64,${img.data}`} alt={`Attached image ${String(i + 1)}`} className="h-16 rounded-md border" />
                      <button
                        type="button"
                        aria-label={`Remove image ${String(i + 1)}`}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-card shadow-card"
                        onClick={() => {
                          setImages(images.filter((_, j) => {
                            return j !== i;
                          }));
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          : null}
        {images.length > 0 && imageNote ? <p className="mb-1 text-xs text-warning" role="status">{imageNote}</p> : null}
        {contextProblems.length > 0 ? <p className="mb-1 text-xs text-destructive" role="alert">{contextProblems.join(" ")}</p> : null}
        {imageProblems.length > 0 ? <p className="mb-1 text-xs text-destructive" role="alert">{imageProblems.join(" ")}</p> : null}

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
                    ref={ref}
                    value={text}
                    rows={1}
                    aria-label="Message"
                    role={listed || project ? "combobox" : undefined}
                    aria-expanded={listed || project ? menu || mentionOpen : undefined}
                    aria-controls={mentionOpen ? `${name}-files` : menu ? `${name}-skills` : undefined}
                    aria-activedescendant={mentionOpen && found.candidates[mentionChosen] ? `${name}-file-${found.candidates[mentionChosen].path}` : menu && matches[chosen] ? `${name}-skill-${matches[chosen].name}` : undefined}
                    placeholder={placeholder ?? (busy && canQueue ? "Write the next message; it is sent when this turn ends" : "Message (markdown works)")}
                    className="relative block max-h-[40vh] min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-transparent caret-foreground outline-none [scrollbar-gutter:stable] selection:bg-primary/30 placeholder:text-muted-foreground forced-colors:text-[CanvasText]"
                    onScroll={(ev) => {
                      if (backdrop.current) {
                        backdrop.current.scrollTop = ev.currentTarget.scrollTop;
                      }
                    }}
                    onChange={(ev) => {
                      setCaret(ev.target.selectionStart);
                      change(ev.target.value);
                    }}
                    onSelect={(ev) => {
                      setCaret(ev.currentTarget.selectionStart);
                    }}
                    onKeyDown={keys}
                    onPaste={(ev) => {
                      const pasted = [...ev.clipboardData.files].filter((f) => {
                        return f.type.startsWith("image/");
                      });
                      if (imagesAllowed && pasted.length > 0) {
                        ev.preventDefault();
                        void attach(pasted);
                      }
                    }}
                  />
                </div>
              )}
          {busy && onStop
            ? (
                <Button type="button" variant="secondary" size="icon" onClick={onStop} aria-label="Stop">
                  <Square className="fill-current" />
                </Button>
              )
            : null}
          {!(busy && onStop) || (canQueue && text.trim() !== "")
            ? (
                <Button type="submit" variant="primary" size="icon" disabled={busyWithText || !text.trim()} aria-label={busy && canQueue ? "Queue message" : "Send"}>
                  <ArrowUp />
                </Button>
              )
            : null}
        </div>
      </div>
      <p className="mt-1 px-2 text-xs text-muted-foreground">Enter sends. Shift+Enter adds a line. Inside a code block Enter adds a line and Ctrl+Enter sends.</p>
    </form>
  );
};
