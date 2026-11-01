import { Code2, MessageSquare, PanelRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Composer } from "@/components/Composer";
import type { Effort } from "@harness/core/effort";
import { ContextMeter } from "@/components/ContextMeter";
import { EffortPicker } from "@/components/EffortPicker";
import { ModelPicker } from "@/components/ModelPicker";
import { ConversationActions } from "@/components/ConversationActions";
import { Message, StatusLine } from "@/components/Messages";
import { SidePanel } from "@/components/SidePanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/fields";
import { useConversation } from "@/lib/useConversation";
import { useSessions, useSkills } from "@/lib/queries";
import { parseSlash } from "@/lib/skills";

const Conversation = ({ id }: { id: string }) => {
  const navigate = useNavigate();
  const sessions = useSessions();
  const { state, send, cancel, answer } = useConversation(id);
  const info = sessions.data?.find((s) => {
    return s.id === id;
  });
  // The model for the next message; until one is picked it is the one the conversation is on.
  const [picked, setPicked] = useState("");
  // The effort for the next message; until one is chosen it is the one the conversation has.
  const [pickedEffort, setPickedEffort] = useState<Effort | "default" | undefined>(undefined);
  const folder = useSkills(info?.kind === "code" ? { device: info.device, root: info.root } : undefined);
  const skills = info?.kind === "code" ? folder.data?.[0]?.skills : undefined;
  const [panel, setPanel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const last = state.items.at(-1);
  const model = info?.model ?? "";

  // Keep the newest words in view, unless the reader has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.items, state.busy]);

  // The status line shows until words start to arrive, and again between a tool and the next call.
  const waiting = state.busy && state.since !== undefined && (last === undefined || last.kind === "user" || last.kind === "tool" || (last.kind === "thinking" && !last.live) || (last.kind === "assistant" && !last.streaming));
  const lastUser = state.items.findLast((i) => {
    return i.kind === "user";
  });
  const failed = !state.busy && last?.kind === "note" && last.tone === "error" && lastUser?.kind === "user";
  const offline = info?.kind === "code" && !info.deviceConnected;

  const panelCount = state.changes.length + (state.plan.length > 0 ? 1 : 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-card px-4 py-2">
          {info?.kind === "code" ? <Code2 className="size-4 text-muted-foreground" /> : <MessageSquare className="size-4 text-muted-foreground" />}
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{info ? (info.title || "New conversation") : "Conversation"}</h1>
          {info ? <Badge tone="brand">{info.model === "auto" ? `Auto${info.chosen ? `: ${info.chosen.model}` : ""}` : info.model}</Badge> : null}
          {info ? <ContextMeter id={id} busy={state.busy} /> : null}
          {info?.kind === "code" ? <Badge tone={info.deviceConnected ? "neutral" : "warning"}>{info.device}:{info.root}{info.deviceConnected ? "" : " offline"}</Badge> : null}
          {info?.kind === "code"
            ? (
                <Button variant="subtle" size="sm" aria-label="Session panel" aria-pressed={panel} onClick={() => {
                  setPanel(!panel);
                }}
                >
                  <PanelRight /> {panelCount > 0 ? <Badge tone="brand">{panelCount}</Badge> : null}
                </Button>
              )
            : null}
          {info
            ? (
                <ConversationActions info={info} onDeleted={() => {
                  void navigate("/");
                }}
                />
              )
            : null}
        </header>

        <div
          ref={scroller}
          className="flex-1 overflow-hidden overflow-y-auto [scrollbar-gutter:stable_both-edges]"
          onScroll={(ev) => {
            const el = ev.currentTarget;
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 overflow-hidden px-4 py-6">
            {state.items.map((item) => {
              return (
                <Message key={item.id} item={item} model={model} onAnswer={(approvalId, approve, always) => {
                  void answer(approvalId, approve, always);
                }}
                />
              );
            })}
            {waiting && state.since !== undefined ? <StatusLine since={state.since} stage={state.stage} /> : null}
            {failed
              ? (
                  <div className="px-10">
                    <Button onClick={() => {
                      stuck.current = true;
                      void send(lastUser.text, undefined, undefined, parseSlash(lastUser.text, skills ?? []));
                    }}
                    >
                      <RotateCcw /> Retry
                    </Button>
                  </div>
                )
              : null}
            {sessions.isSuccess && !info ? <p className="text-center text-muted-foreground">This conversation no longer exists.</p> : null}
          </div>
        </div>

        {offline ? <p className="mx-auto w-full max-w-3xl px-4 pb-2 text-[13px] text-muted-foreground">The device {info.device} is offline, so this conversation is read-only until it reconnects.</p> : null}
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-1.5 text-xs text-muted-foreground">
          <span>Next message goes to</span>
          <ModelPicker className="h-7 w-auto max-w-64 text-xs" value={picked || model} disabled={state.busy || !info} onChange={setPicked} />
          <EffortPicker className="h-7 w-auto max-w-40 text-xs" model={(picked || model) === "auto" ? (info?.chosen?.model ?? "auto") : (picked || model)} value={pickedEffort === "default" ? undefined : (pickedEffort ?? info?.effort)} disabled={state.busy || !info} onChange={(next) => {
            setPickedEffort(next ?? "default");
          }}
          />
        </div>
        <Composer
          draftKey={id}
          busy={state.busy}
          disabled={!info || offline}
          skills={skills}
          onSend={(text) => {
            stuck.current = true;
            void send(text, picked || undefined, pickedEffort, parseSlash(text, skills ?? []));
          }}
          onStop={() => {
            void cancel();
          }}
        />
      </div>
      {panel && info?.kind === "code"
        ? (
            <SidePanel changes={state.changes} plan={state.plan} onClose={() => {
              setPanel(false);
            }}
            />
          )
        : null}
    </div>
  );
};

// Keyed by id so moving between conversations starts each with its own state and draft.
export const ConversationView = () => {
  const { id } = useParams();
  return id ? <Conversation key={id} id={id} /> : null;
};
