import { ArrowUp, Square } from "lucide-react";
import { useRef, useState, type SyntheticEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

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

// The message box. What was typed and not sent is kept for each conversation, so a refresh does not lose it.
export const Composer = ({ draftKey, busy, disabled, placeholder, onSend, onStop }: { draftKey: string; busy: boolean; disabled?: boolean; placeholder?: string; onSend: (text: string) => void; onStop?: () => void }) => {
  const name = `harness-draft-${draftKey}`;
  const [text, setText] = useState(() => {
    return read(name);
  });
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = (): void => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${String(Math.min(el.scrollHeight, window.innerHeight * 0.4))}px`;
    }
  };

  const submit = (): void => {
    const value = text.trim();
    if (!value || busy || disabled) {
      return;
    }
    write(name, "");
    setText("");
    if (ref.current) {
      ref.current.style.height = "auto";
    }
    onSend(value);
  };

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={(ev: SyntheticEvent) => {
        ev.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-card focus-within:border-primary">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label="Message"
          placeholder={placeholder ?? "Message"}
          className="max-h-[40vh] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted-foreground"
          onChange={(ev) => {
            setText(ev.target.value);
            write(name, ev.target.value);
            grow();
          }}
          onKeyDown={(ev: KeyboardEvent) => {
            if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
              ev.preventDefault();
              submit();
            }
          }}
        />
        {busy && onStop
          ? (
              <Button type="button" variant="secondary" size="icon" onClick={onStop} aria-label="Stop">
                <Square className="fill-current" />
              </Button>
            )
          : (
              <Button type="submit" variant="primary" size="icon" disabled={busy || (disabled ?? false) || !text.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
      </div>
    </form>
  );
};
