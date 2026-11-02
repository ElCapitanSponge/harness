import { Bot, Brain, ChevronRight, CircleHelp, GitBranch, Layers, Sparkles, Loader2, ShieldQuestion, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Markdown } from "@/components/Markdown";
import type { ConversationState, Item } from "@/lib/conversation";
import { compact as compactTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

// Seconds since a start time, ticking every second while `running`.
const useElapsed = (startedAt: number, running: boolean): number => {
  const [now, setNow] = useState(() => {
    return Date.now();
  });
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return Math.max(0, Math.round((now - startedAt) / 1000));
};

const Thinking = ({ item }: { item: Extract<Item, { kind: "thinking" }> }) => {
  const elapsed = useElapsed(item.startedAt, item.live);
  const label = item.live ? `Thinking... ${String(elapsed)}s` : item.seconds > 0 ? `Thought for ${String(item.seconds)}s` : "Thinking";
  return (
    <details className="group rounded-lg text-muted-foreground" open={item.live}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold hover:bg-muted">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <Brain className="size-3.5" />
        {label}
        {item.live ? <Loader2 className="size-3 animate-spin" /> : null}
      </summary>
      <div className="mt-1 whitespace-pre-wrap border-l-2 pl-3 [overflow-wrap:anywhere] text-[13px] leading-5">{item.text}</div>
    </details>
  );
};

// A question the model put to the person: the likely answers as buttons, and a box for their own words.
const Question = ({ item, onReply }: { item: Extract<Item, { kind: "question" }>; onReply?: (questionId: string, answer: string) => void }) => {
  const [text, setText] = useState("");
  const pending = item.status === "pending";
  return (
    <div className="px-10">
      <div className={cn("grid gap-2 rounded-lg border border-primary bg-card p-3 shadow-card", !pending && "border-border opacity-80 shadow-none")} role="group" aria-label="Question">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <CircleHelp className="size-4 text-primary" />
          Question
        </div>
        <div className="[overflow-wrap:anywhere]">{item.question}</div>
        {pending
          ? (
              <>
                {item.options.length > 0
                  ? (
                      <div className="flex flex-wrap gap-2">
                        {item.options.map((o) => {
                          return (
                            <Button key={o} onClick={() => {
                              onReply?.(item.questionId, o);
                            }}
                            >
                              {o}
                            </Button>
                          );
                        })}
                      </div>
                    )
                  : null}
                <form
                  className="flex gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (text.trim()) {
                      onReply?.(item.questionId, text.trim());
                    }
                  }}
                >
                  <Input aria-label="Your answer" placeholder="Or answer in your own words" value={text} onChange={(ev) => {
                    setText(ev.target.value);
                  }}
                  />
                  <Button type="submit" variant="primary" disabled={!text.trim()}>Answer</Button>
                </form>
              </>
            )
          : <div className="text-[13px] text-muted-foreground">{item.status === "answered" ? `You answered: ${item.answer ?? ""}` : "Nobody answered."}</div>}
      </div>
    </div>
  );
};

export const Message = ({ item, model, onAnswer, onReply }: { item: Item; model: string; onAnswer: (approvalId: string, approve: boolean, always: boolean) => void; onReply?: (questionId: string, answer: string) => void }) => {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex min-w-0 justify-end">
          <div className="min-w-0 max-w-[85%] rounded-xl bg-accent px-4 py-2 text-accent-foreground">
            {item.images?.length
              ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {item.images.map((img, i) => {
                      return <img key={`${String(i)}-${img.data.slice(-12)}`} src={`data:${img.mediaType};base64,${img.data}`} alt={`Attached image ${String(i + 1)}`} className="max-h-48 max-w-full rounded-md border" />;
                    })}
                  </div>
                )
              : null}
            <Markdown text={item.text} />
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex gap-3">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0 flex-1 pr-10">
            <div className="mb-0.5 text-xs font-semibold text-muted-foreground">{item.model ?? model}{item.device ? <span className="font-normal"> on {item.device}</span> : null}{item.reason ? <span className="font-normal"> - Auto: {item.reason}</span> : null}</div>
            <Markdown text={item.text} />
            {item.streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" aria-hidden /> : null}
          </div>
        </div>
      );

    case "thinking":
      return (
        <div className="px-10">
          <Thinking item={item} />
        </div>
      );

    case "skill":
      return (
        <div className="px-10">
          <details className="group rounded-lg text-muted-foreground">
            <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold hover:bg-muted">
              <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
              <Sparkles className="size-3.5 shrink-0" />
              <span className="truncate">Skill: {item.name}{item.arguments ? ` - ${item.arguments}` : ""}</span>
            </summary>
            <div className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3 [overflow-wrap:anywhere] text-[13px] leading-5">{item.text}</div>
          </details>
        </div>
      );

    case "tool":
      return (
        <div className="px-10">
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono text-xs text-muted-foreground">
            <Wrench className="size-3.5 shrink-0" />
            <span className="break-all">{item.summary}</span>
          </div>
        </div>
      );

    case "compaction":
      return (
        <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator" aria-label="Conversation compacted">
          <span className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1.5">
            <Layers className="size-3.5" />
            {item.manual ? "Compacted" : "Compacted automatically"}: {item.messages} earlier messages summarised, about {compactTokens(item.tokensBefore)} to {compactTokens(item.tokensAfter)} tokens
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      );

    case "approval":
      return (
        <div className="px-10">
          <div className={cn("grid gap-2 rounded-lg border border-primary bg-card p-3 shadow-card", item.status !== "pending" && "border-border opacity-80 shadow-none")}>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <ShieldQuestion className="size-4 text-primary" />
              Approval needed: {item.tool}
              {item.status === "allowed" ? " (allowed)" : item.status === "declined" ? " (declined)" : ""}
            </div>
            <div className="break-all font-mono text-[13px]">{item.summary}</div>
            {item.status === "pending"
              ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => {
                      onAnswer(item.approvalId, true, false);
                    }}
                    >
                      Allow
                    </Button>
                    <Button onClick={() => {
                      onAnswer(item.approvalId, true, true);
                    }}
                    >
                      Always allow {item.tool}
                    </Button>
                    <Button variant="subtle" onClick={() => {
                      onAnswer(item.approvalId, false, false);
                    }}
                    >
                      Decline
                    </Button>
                  </div>
                )
              : null}
          </div>
        </div>
      );

    case "subagent":
      return (
        <div className="px-10">
          <details className="group rounded-lg border bg-card p-2 text-[13px]">
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
              <GitBranch className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-semibold">Sub-agent: {item.task}</span>
              {item.status === "running" ? <Loader2 className="size-3.5 animate-spin" aria-label="running" /> : <span className={cn("text-xs", item.status === "failed" && "text-destructive")}>{item.status}</span>}
            </summary>
            <div className="mt-2 grid gap-1">
              <div className="text-xs text-muted-foreground">Sub-agent {item.n} of {item.of} allowed here, nested {item.depth} deep.</div>
              {item.result ? <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.result}</div> : null}
              <Link to={`/c/${item.childId}`} className="w-fit text-primary underline">Open its conversation</Link>
            </div>
          </details>
        </div>
      );

    case "question":
      return <Question item={item} onReply={onReply} />;

    case "note":
      return (
        <div className={cn("px-10 text-[13px]", item.tone === "error" ? "text-destructive" : "text-muted-foreground")} role={item.tone === "error" ? "alert" : undefined}>
          {item.text}
        </div>
      );
  }
};

// What the request is doing, in a few words.
export const stageLabel = (stage: ConversationState["stage"]): string => {
  switch (stage?.name) {
    case undefined:
      return "Sending";
    case "routing":
      return "Finding a device";
    case "freeing":
      return `Freeing memory (unloading ${stage.detail ?? "a model"})`;
    case "loading":
      return `Loading ${stage.detail ?? "the model"}`;
    case "waiting":
      return `Waiting for ${stage.detail ?? "the model"}`;
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing";
    case "compacting":
      return "Compacting the conversation to free space";
  }
};

// One status line from the moment Send is pressed until the first word arrives, with a running timer, so a slow
// model load reads as work in progress and not a hang.
export const StatusLine = ({ since, stage }: { since: number; stage: ConversationState["stage"] }) => {
  const elapsed = useElapsed(since, true);
  return (
    <div className="flex items-center gap-2 px-10 text-[13px] text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" />
      {stageLabel(stage)}... {elapsed}s
    </div>
  );
};
