import { FileUp, Merge, Scissors, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Checkbox, Select, Textarea } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { ImportedConversation, ParsedImport, SessionInfo, Turn } from "@/lib/types";

interface Draft extends ImportedConversation {
  selected: boolean;
}

const FORMATS: Record<string, string> = {
  "headings": "## User / ## Assistant headings",
  "said": "\"You said:\" / \"ChatGPT said:\" lines",
  "labels": "User: / Assistant: labels",
  "claude-code-export": "a Claude Code /export",
  "claude-code": "a Claude Code transcript file",
  "chatgpt": "a ChatGPT export",
  "claude-ai": "a Claude.ai export",
  "unsplit": "no turns found",
};

const TurnRow = ({ turn, index, count, onChange, onMerge, onRemove }: { turn: Turn; index: number; count: number; onChange: (turn: Turn) => void; onMerge: () => void; onRemove: () => void }) => {
  return (
    <li className="grid gap-1 rounded-lg border bg-card p-2">
      <div className="flex items-center gap-2">
        <Select aria-label={`Who wrote message ${String(index + 1)}`} className="h-7 w-auto text-xs" value={turn.role} onChange={(ev) => {
          onChange({ ...turn, role: ev.target.value === "user" ? "user" : "assistant" });
        }}
        >
          <option value="user">You</option>
          <option value="assistant">Assistant</option>
        </Select>
        <span className="flex-1" />
        <Button variant="subtle" size="icon" className="size-7" aria-label={`Merge message ${String(index + 1)} into the one before`} disabled={index === 0} onClick={onMerge}><Merge /></Button>
        <Button variant="subtle" size="icon" className="size-7" aria-label={`Remove message ${String(index + 1)}`} disabled={count === 1} onClick={onRemove}><Trash2 /></Button>
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-sans text-[13px]">{turn.text}</pre>
    </li>
  );
};

const stop = (ev: { stopPropagation: () => void }): void => {
  ev.stopPropagation();
};

// Brings a conversation in from another tool: paste a transcript or drop an export, check how it was split, fix what is wrong, and save
// it as a conversation to carry on with any model. Nothing is sent to a model.
export const ImportView = () => {
  const navigate = useNavigate();
  const client = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ format: string; split: boolean; drafts: Draft[] } | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const parse = async (name: string, content: string): Promise<void> => {
    setError("");
    setBusy(true);
    try {
      const result = await api<ParsedImport>("/import/parse", { method: "POST", body: { name, content } });
      setParsed({ format: result.format, split: result.split, drafts: result.conversations.map((c) => {
        return { ...c, selected: result.conversations.length === 1 };
      }) });
    } catch (err) {
      setParsed(undefined);
      setError(err instanceof Error ? err.message : "Could not read that.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (index: number, change: (draft: Draft) => Draft): void => {
    setParsed((p) => {
      return p && { ...p, drafts: p.drafts.map((d, i) => {
        return i === index ? change(d) : d;
      }) };
    });
  };

  const select = (index: number, selected: boolean): void => {
    edit(index, (x) => {
      return { ...x, selected };
    });
  };

  const chosen = parsed?.drafts.filter((d) => {
    return d.selected && d.turns.length > 0;
  }) ?? [];

  const save = async (): Promise<void> => {
    setError("");
    setBusy(true);
    try {
      let first: SessionInfo | undefined;
      for (const d of chosen) {
        const info = await api<SessionInfo>("/sessions/import", { method: "POST", body: { title: d.title, source: d.source, turns: d.turns } });
        first ??= info;
      }
      await client.invalidateQueries({ queryKey: ["sessions"] });
      await navigate(first ? `/c/${first.id}` : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import.");
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Import a conversation</h1>
          <p className="text-muted-foreground">Bring a chat from Claude Code, ChatGPT or Claude.ai, then carry on with any model. Nothing is sent to a model while importing.</p>
        </div>

        <div className="grid gap-2">
          <label htmlFor="import-text" className="font-semibold">Paste a transcript</label>
          <Textarea id="import-text" rows={8} className="font-mono text-[13px]" placeholder={"## User\n...\n\n## Assistant\n..."} value={text} onChange={(ev) => {
            setText(ev.target.value);
          }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || text.trim() === ""} onClick={() => {
              void parse("pasted.txt", text);
            }}
            >
              Find the messages
            </Button>
            <span className="text-muted-foreground">or</span>
            <input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="Choose a file to import"
              accept=".jsonl,.json,.md,.txt"
              onChange={(ev) => {
                const chosenFile = ev.target.files?.[0];
                ev.target.value = "";
                if (chosenFile) {
                  void chosenFile.text().then((content) => {
                    return parse(chosenFile.name, content);
                  });
                }
              }}
            />
            <Button disabled={busy} onClick={() => {
              file.current?.click();
            }}
            >
              <FileUp /> Choose a file
            </Button>
            <span className="text-xs text-muted-foreground">A Claude Code .jsonl, a ChatGPT conversations.json, a Claude.ai export, or text.</span>
          </div>
        </div>

        {error ? <p className="text-destructive" role="alert">{error}</p> : null}

        {parsed
          ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">What was found</h2>
                  <Badge tone={parsed.split ? "success" : "warning"}>{FORMATS[parsed.format] ?? parsed.format}</Badge>
                </div>
                {parsed.split
                  ? null
                  : <p className="text-[13px] text-muted-foreground">The text could not be split into turns, so it is one message from you. Change who wrote it, or split it at blank lines and assign each part.</p>}

                {parsed.drafts.map((d, i) => {
                  return (
                    <details key={`${String(i)}-${d.title}`} className="rounded-xl border bg-card p-3" open={parsed.drafts.length === 1}>
                      <summary className="flex cursor-pointer list-none items-center gap-2">
                        {parsed.drafts.length > 1
                          ? (
                              <Checkbox aria-label={`Import ${d.title}`} checked={d.selected} onClick={stop} onCheckedChange={(value) => {
                                select(i, value === true);
                              }}
                              />
                            )
                          : null}
                        <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
                        <Badge tone="neutral">{d.source}</Badge>
                        <span className="text-xs text-muted-foreground">{d.turns.length} message{d.turns.length === 1 ? "" : "s"}</span>
                      </summary>
                      <div className="mt-3 grid gap-2">
                        {!parsed.split
                          ? (
                              <Button size="sm" className="w-fit" onClick={() => {
                                edit(i, (x) => {
                                  const whole = x.turns.map((t) => {
                                    return t.text;
                                  }).join("\n\n");
                                  return { ...x, turns: whole.split(/\n{2,}/).filter((p) => {
                                    return p.trim() !== "";
                                  }).map((p, n): Turn => {
                                    return { role: n % 2 === 0 ? "user" : "assistant", text: p.trim() };
                                  }) };
                                });
                              }}
                              >
                                <Scissors /> Split at blank lines
                              </Button>
                            )
                          : null}
                        <ul className="grid gap-2" aria-label={`Messages in ${d.title}`}>
                          {d.turns.map((t, n) => {
                            return (
                              <TurnRow
                                key={`${String(n)}-${t.text.slice(0, 20)}`}
                                turn={t}
                                index={n}
                                count={d.turns.length}
                                onChange={(next) => {
                                  edit(i, (x) => {
                                    return { ...x, turns: x.turns.map((y, j) => {
                                      return j === n ? next : y;
                                    }) };
                                  });
                                }}
                                onMerge={() => {
                                  edit(i, (x) => {
                                    const before = x.turns[n - 1];
                                    return before ? { ...x, turns: [...x.turns.slice(0, n - 1), { ...before, text: `${before.text}\n\n${t.text}` }, ...x.turns.slice(n + 1)] } : x;
                                  });
                                }}
                                onRemove={() => {
                                  edit(i, (x) => {
                                    return { ...x, turns: x.turns.filter((_, j) => {
                                      return j !== n;
                                    }) };
                                  });
                                }}
                              />
                            );
                          })}
                        </ul>
                      </div>
                    </details>
                  );
                })}

                <div>
                  <Button variant="primary" size="lg" disabled={busy || chosen.length === 0} onClick={() => {
                    void save();
                  }}
                  >
                    Import {chosen.length > 1 ? `${String(chosen.length)} conversations` : "conversation"}
                  </Button>
                </div>
              </div>
            )
          : null}
      </div>
    </div>
  );
};
