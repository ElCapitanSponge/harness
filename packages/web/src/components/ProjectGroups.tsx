import { ChevronDown, ChevronRight, Code2, HandHelping, LoaderCircle, MessageSquare, Plus } from "lucide-react";
import { NavLink } from "react-router";
import { ConversationActions } from "@/components/ConversationActions";
import { Button } from "@/components/ui/button";
import { baseName } from "@/lib/desktop";
import { statusLabel, statusOf } from "@/lib/status";
import { groupKey, type Group } from "@/lib/groups";
import type { SessionInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  groups: Group[];
  // The groups the person collapsed, as keys from groupKey.
  collapsed: ReadonlySet<string>;
  pathname: string;
  onToggle: (group: Group, collapsed: boolean) => void;
  onNew: (group: Group) => void;
  onNavigate: () => void;
  onDeleted: (info: SessionInfo) => void;
}

// The conversations in the sidebar, a group to each project, as Claude Code lists them. A project shows its folder's name and which
// device it is on (this device, or another by name); chats are gathered under their own heading.
export const ProjectGroups = ({ groups, collapsed, pathname, onToggle, onNew, onNavigate, onDeleted }: Props) => {
  return (
    <div className="grid gap-2">
      {groups.map((group) => {
        // A project or the chats are open unless the person closed them; the Archive is closed unless they opened it (see ARCHIVE_ENTRY).
        const closed = group.kind === "archive" ? !collapsed.has(group.key) : group.kind === "project" || group.kind === "chats" ? collapsed.has(group.key) : false;
        const Chevron = closed ? ChevronRight : ChevronDown;
        return (
          <section key={group.key} aria-label={group.kind === "project" ? `${group.name} on ${group.device}` : group.name}>
            <div className="group/head flex items-center gap-0.5">
              {group.kind === "pinned"
                ? <span className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinned</span>
                : (
                    <button
                      type="button"
                      aria-expanded={!closed}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left hover:bg-muted"
                      onClick={() => {
                        onToggle(group, !closed);
                      }}
                    >
                      <Chevron className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</span>
                        {group.kind !== "project" ? null : <span className="block truncate text-xs font-normal text-muted-foreground" title={`${group.device}:${group.root}`}>{group.here ? "This device" : group.device}</span>}
                      </span>
                      {group.kind === "archive" && closed && group.items.some(({ info: i }) => {
                        return statusOf(i, pathname === `/c/${i.id}`) === "needs-you";
                      })
                        ? <HandHelping className="size-4 shrink-0 text-warning" aria-label="Something in the archive is waiting for you" />
                        : null}
                    </button>
                  )}
              {group.kind === "pinned" || group.kind === "archive"
                ? null
                : (
                    <Button variant="subtle" size="icon" className="size-7 opacity-0 focus-visible:opacity-100 group-hover/head:opacity-100" aria-label={group.kind === "project" ? `New session in ${group.name}` : "New chat"} title={group.kind === "project" ? "New session in this project" : "New chat"} onClick={() => {
                      onNew(group);
                    }}
                    >
                      <Plus />
                    </Button>
                  )}
            </div>
            {closed
              ? null
              : (
                  <ul className="grid gap-0.5">
                    {group.items.map(({ info: c, indent }) => {
                      const status = statusOf(c, pathname === `/c/${c.id}`);
                      return (
                        <li key={c.id} className="group relative" style={indent > 0 ? { paddingLeft: `${String(indent * 14)}px` } : undefined}>
                          <NavLink
                            to={`/c/${c.id}`}
                            onClick={onNavigate}
                            className={({ isActive }) => {
                              return cn("flex items-center gap-2 rounded-md py-1.5 pl-2 pr-9 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground hover:bg-accent");
                            }}
                          >
                            {status === "working"
                              ? <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                              : status === "needs-you"
                                ? <HandHelping className="size-4 shrink-0 text-warning" />
                                : c.kind === "code" ? <Code2 className="size-4 shrink-0 text-muted-foreground" /> : <MessageSquare className="size-4 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate", status === "unread" && "font-semibold")}>{c.title || "New conversation"}</span>
                              {(group.kind === "pinned" || group.kind === "archive") && c.kind === "code" ? <span className="block truncate text-xs font-normal text-muted-foreground">{baseName(c.root)} · {c.device}{c.deviceConnected ? "" : " (offline)"}</span> : null}
                              {group.kind !== "pinned" && group.kind !== "archive" && c.kind === "code" && !c.deviceConnected ? <span className="block truncate text-xs font-normal text-muted-foreground">offline</span> : null}
                            </span>
                            {status === undefined ? null : <span className="sr-only">{statusLabel(status, c)}</span>}
                            {status === "unread" ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
                          </NavLink>
                          <ConversationActions
                            info={c}
                            className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onDeleted={() => {
                              if (pathname === `/c/${c.id}`) {
                                onDeleted(c);
                              }
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
          </section>
        );
      })}
    </div>
  );
};

export const collapsedKeys = (list: { device: string; root: string }[]): Set<string> => {
  return new Set(list.map((g) => {
    return groupKey(g.device, g.root);
  }));
};
