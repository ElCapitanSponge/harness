import { Bell, Code2, MessageSquare, PanelRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Composer } from "@/components/Composer";
import { QueuedMessages } from "@/components/QueuedMessages";
import type { Effort } from "@harness/core/effort";
import { ContextMeter } from "@/components/ContextMeter";
import { EffortPicker } from "@/components/EffortPicker";
import { ModePicker } from "@/components/ModePicker";
import { ModelPicker, useModels } from "@/components/ModelPicker";
import { noImagesReason, supportsImages } from "@harness/core/image";
import { ConversationActions } from "@/components/ConversationActions";
import { Message, StatusLine } from "@/components/Messages";
import { SidePanel } from "@/components/SidePanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/fields";
import { useConversation } from "@/lib/useConversation";
import { contextBlock } from "@/lib/desktop";
import { useNotifications } from "@/lib/notify";
import { compact as compactNumber } from "@/lib/format";
import { INIT_PROMPT, permissionArg, resolveModel, unavailable } from "@/lib/commands";
import { useClearDonePlan, useClearFinishedTasks, useCompactConversation, useLibrary, useSessions, useSetMode, useSessionTasks, useSkills } from "@/lib/queries";
import { parseSlash, withLibrary } from "@/lib/skills";

const Conversation = ({ id }: { id: string }) => {
  const navigate = useNavigate();
  const sessions = useSessions();
  const { state, send, cancel, answer, reply, editQueued, removeQueued, sendQueuedNow } = useConversation(id);
  const info = sessions.data?.find((s) => {
    return s.id === id;
  });
  // The model for the next message; until one is picked it is the one the conversation is on.
  const [picked, setPicked] = useState("");
  // The effort for the next message; until one is chosen it is the one the conversation has.
  const [pickedEffort, setPickedEffort] = useState<Effort | "default" | undefined>(undefined);
  const folder = useSkills(info?.kind === "code" ? { device: info.device, root: info.root } : undefined);
  const library = useLibrary();
  const skills = withLibrary(info?.kind === "code" ? folder.data?.[0]?.skills : undefined, library.data);
  const [panel, setPanel] = useState(false);
  const setMode = useSetMode(id);
  const compactNow = useCompactConversation(id);
  const { catalogue } = useModels();
  // What the last command said, shown above the message box until the next message.
  const [notice, setNotice] = useState("");
  // Text to add to the message being written (a file from the panel), with a counter so the same text can be added twice.
  const [insertion, setInsertion] = useState<{ id: number; text: string } | undefined>();
  const addContext = (path: string, text: string, shortened: boolean): void => {
    setInsertion((current) => {
      return { id: (current?.id ?? 0) + 1, text: contextBlock(`${path}${shortened ? " (shortened)" : ""}`, text) };
    });
  };
  const notifications = useNotifications(state.items);
  const tasks = useSessionTasks(id, panel && info?.kind === "code");
  const clearTasks = useClearFinishedTasks(id);
  const clearPlan = useClearDonePlan(id);
  const clearFinishedTasks = (): void => {
    clearPlan.reset();
    clearTasks.mutate();
  };
  const clearDonePlan = (): void => {
    clearTasks.reset();
    clearPlan.mutate();
  };
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const last = state.items.at(-1);
  const model = info?.model ?? "";

  // A built-in command typed in the message box (see lib/commands).
  const runCommand = (name: string, args: string): void => {
    setNotice("");
    const why = unavailable(name, { conversation: info !== undefined, code: info?.kind === "code" });
    if (why) {
      setNotice(why);
      return;
    }
    switch (name) {
      case "compact":
        if (state.busy) {
          setNotice("Wait for the reply to finish before compacting.");
          return;
        }
        compactNow.mutate(undefined, {
          onSuccess: (result) => {
            setNotice(`Compacted ${String(result.messages)} messages: about ${compactNumber(result.tokensBefore)} tokens down to ${compactNumber(result.tokensAfter)}.`);
          },
          onError: (err) => {
            setNotice(err.message);
          },
        });
        return;
      case "clear": {
        const query = new URLSearchParams({ ...(info?.kind === "code" ? { device: info.device, root: info.root } : {}), ...(info?.model ? { model: info.model } : {}) });
        void navigate(`/?${query.toString()}`);
        return;
      }
      case "model": {
        if (args === "") {
          document.querySelector<HTMLSelectElement>("select[aria-label=\"Model\"]")?.focus();
          setNotice(`The next message goes to ${picked || model}. Choose another in the model box above, or type /model and a name.`);
          return;
        }
        const data = catalogue.data;
        const ids = ["auto", ...(data?.models ?? []).filter((m) => {
          return m.state === "loaded" || m.state === "loads-on-use";
        }).map((m) => {
          return m.id;
        }), ...(data?.claude.available ? data.claude.models : [])];
        const found = resolveModel(args, ids);
        if ("error" in found) {
          setNotice(found.error);
        } else {
          setPicked(found.id);
          setNotice(`The next message goes to ${found.id}.`);
        }
        return;
      }
      case "permissions": {
        const mode = permissionArg(args);
        if (args === "" || !mode) {
          setNotice(`${args === "" ? "" : `"${args}" is not a mode. `}This conversation is on ${info?.mode ?? "ask"}. Use /permissions ask, edits, plan or bypass.`);
          return;
        }
        setMode.mutate(mode, {
          onSuccess: () => {
            setNotice(`Changes are now treated as: ${mode}.`);
          },
          onError: (err) => {
            setNotice(err.message);
          },
        });
        return;
      }
      case "init":
        stuck.current = true;
        void send(INIT_PROMPT, picked || undefined, pickedEffort);
        setNotice("Asked the model to draft an AGENTS.md. It will show you the draft and ask before writing it.");
        return;
    }
  };

  // Keep the newest words in view, unless the reader has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.items, state.busy]);

  // The status line shows until words start to arrive, and again between a tool and the next call.
  const waiting = state.busy && state.since !== undefined && (last === undefined || last.kind === "user" || last.kind === "actions" || (last.kind === "thinking" && !last.live) || (last.kind === "assistant" && !last.streaming));
  const lastUser = state.items.findLast((i) => {
    return i.kind === "user";
  });
  const failed = !state.busy && last?.kind === "note" && last.tone === "error" && lastUser?.kind === "user";
  const offline = info?.kind === "code" && !info.deviceConnected;

  // Auto picks a model that can read images when it can; a model picked by hand is checked here.
  const next = picked || model;
  const imageNote = next === "auto" || next === "" || supportsImages(next) ? "" : noImagesReason(next);
  const panelCount = state.changes.length + state.shots.length + (state.plan.length > 0 || state.planDocs.length > 0 ? 1 : 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
          {info?.kind === "code" ? <Code2 className="size-4 text-muted-foreground" /> : <MessageSquare className="size-4 text-muted-foreground" />}
          <h1 className="min-w-0 flex-1 basis-40 truncate text-base font-semibold">{info ? (info.title || "New conversation") : "Conversation"}</h1>
          {info ? <Badge tone="brand">{info.model === "auto" ? `Auto${info.chosen ? `: ${info.chosen.model}` : ""}` : info.model}</Badge> : null}
          {info ? <ContextMeter id={id} busy={state.busy} /> : null}
          {info?.kind === "code" ? <Badge tone={info.deviceConnected ? "neutral" : "warning"} className="max-w-full [overflow-wrap:anywhere]">{info.device}:{info.root}{info.deviceConnected ? "" : " offline"}</Badge> : null}
          {notifications.permission === "default"
            ? (
                <Button variant="subtle" size="icon" aria-label="Notify me when I am needed" title="Notify me when the model needs an answer and this page is in the background" onClick={notifications.ask}>
                  <Bell />
                </Button>
              )
            : null}
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
                <Message key={item.id} item={item} model={model} onAnswer={(approvalId, approve, always, reason) => {
                  void answer(approvalId, approve, always, reason);
                }} onReply={(questionId, text) => {
                  void reply(questionId, text);
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
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 pb-1.5 text-xs text-muted-foreground">
          <span>Next message goes to</span>
          <ModePicker className="h-7 w-auto max-w-48 text-xs" value={info?.mode ?? "ask"} disabled={!info || info.kind === "chat"} onChange={(mode) => {
            setMode.mutate(mode);
          }}
          />
          <ModelPicker className="h-7 w-auto max-w-64 text-xs" value={picked || model} disabled={state.busy || !info} onChange={setPicked} />
          <EffortPicker className="h-7 w-auto max-w-40 text-xs" model={(picked || model) === "auto" ? (info?.chosen?.model ?? "auto") : (picked || model)} value={pickedEffort === "default" ? undefined : (pickedEffort ?? info?.effort)} disabled={state.busy || !info} onChange={(next) => {
            setPickedEffort(next ?? "default");
          }}
          />
        </div>
        {notice ? <p className="mx-auto w-full max-w-3xl px-4 pb-1.5 text-[13px] text-muted-foreground" role="status">{notice}</p> : null}
        <QueuedMessages
          messages={state.queue}
          held={state.queueHeld}
          onEdit={(queueId, text) => {
            void editQueued(queueId, text);
          }}
          onRemove={(queueId) => {
            void removeQueued(queueId);
          }}
          onSendNow={(queueId) => {
            void sendQueuedNow(queueId);
          }}
        />
        <Composer
          draftKey={id}
          busy={state.busy}
          canQueue
          disabled={!info || offline}
          skills={skills}
          insertion={insertion}
          onCommand={runCommand}
          project={info?.kind === "code" && info.device !== "" ? { device: info.device, root: info.root } : undefined}
          imageNote={imageNote}
          onSend={(text, images) => {
            stuck.current = true;
            void send(text, picked || undefined, pickedEffort, parseSlash(text, skills ?? []), images);
          }}
          onStop={() => {
            void cancel();
          }}
        />
      </div>
      {panel && info?.kind === "code"
        ? (
            <SidePanel changes={state.changes} plan={state.plan} planDocs={state.planDocs} tasks={tasks.data} shots={state.shots} clearError={clearTasks.error?.message ?? clearPlan.error?.message} onClearTasks={clearFinishedTasks} onClearPlan={clearDonePlan} files={info.device !== "" ? { device: info.device, root: info.root, onAdd: addContext } : undefined} onClose={() => {
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
