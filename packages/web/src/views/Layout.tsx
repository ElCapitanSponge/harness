import { useSelector } from "@tanstack/react-store";
import { BarChart3, Menu as MenuIcon, Monitor, Moon, PanelLeftClose, FileUp, ShieldCheck, Sparkles, Sun, SunMoon, LogOut } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ClaudeMeter } from "@/components/ClaudeMeter";
import { collapsedKeys, ProjectGroups } from "@/components/ProjectGroups";
import { ToriiMark } from "@/components/ToriiMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { keyStore, setKey } from "@/lib/api";
import { groupSessions } from "@/lib/groups";
import { useCollapsedGroups, useSessions, useSetCollapsed } from "@/lib/queries";
import { useNeedsYou } from "@/lib/useNeedsYou";
import { useThisDevice } from "@/lib/useThisDevice";
import { setTheme, themeStore, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ThisDevice } from "@/components/ThisDevice";

const Gate = () => {
  const [value, setValue] = useState("");
  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="grid w-full max-w-sm gap-4 rounded-xl border bg-card p-6 shadow-card"
        autoComplete="off"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (value.trim()) {
            setKey(value.trim());
          }
        }}
      >
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ToriiMark /></span>
          Torii
        </div>
        <p className="text-muted-foreground">Enter the gateway key to continue. It is kept for this browser tab only.</p>
        <Input type="password" placeholder="API key" autoFocus autoComplete="off" aria-label="API key" value={value} onChange={(ev) => {
          setValue(ev.target.value);
        }}
        />
        <Button type="submit" variant="primary" size="lg">Connect</Button>
      </form>
    </div>
  );
};

const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "system", icon: SunMoon, label: "Match system" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
];

const Sidebar = ({ onNavigate }: { onNavigate: () => void }) => {
  const sessions = useSessions();
  const theme = useSelector(themeStore);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const here = useThisDevice().here;
  const stored = useCollapsedGroups();
  const setCollapsed = useSetCollapsed();
  const groups = groupSessions(sessions.data ?? [], here.state === "device" ? here.nodeId : undefined);
  const collapsed = collapsedKeys(stored.data ?? []);

  return (
    <div className="flex h-full flex-col gap-2 bg-card p-3">
      <div className="flex items-center gap-2 px-2 py-1 text-base font-semibold">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ToriiMark className="size-4.5" /></span>
        Torii
      </div>
      <ThisDevice onNavigate={onNavigate} />

      <nav aria-label="Conversations" className="-mx-1 mt-1 flex-1 overflow-y-auto overflow-x-hidden px-1">
        {sessions.isPending ? <p className="px-2 py-1 text-muted-foreground">Loading...</p> : null}
        {sessions.data?.length === 0 ? <p className="px-2 py-1 text-muted-foreground">No conversations yet.</p> : null}
        <ProjectGroups
          groups={groups}
          collapsed={collapsed}
          pathname={pathname}
          onToggle={(group, value) => {
            // The Archive is stored the other way round: an entry in the list means it is open.
            setCollapsed.mutate({ device: group.device, root: group.root, collapsed: group.kind === "archive" ? !value : value });
          }}
          onNew={(group) => {
            void navigate(group.kind === "project" ? `/?device=${encodeURIComponent(group.device)}&root=${encodeURIComponent(group.root)}` : "/");
            onNavigate();
          }}
          onNavigate={onNavigate}
          onDeleted={() => {
            void navigate("/");
          }}
        />
      </nav>

      <div className="grid gap-1 border-t pt-2">
        <ClaudeMeter />
        <NavLink
          to="/manage/devices"
          onClick={onNavigate}
          className={({ isActive }) => {
            return cn("flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground");
          }}
        >
          <Monitor className="size-4" /> Devices
        </NavLink>
        <NavLink
          to="/manage/permissions"
          onClick={onNavigate}
          className={({ isActive }) => {
            return cn("flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground");
          }}
        >
          <ShieldCheck className="size-4" /> Permissions
        </NavLink>
        <NavLink
          to="/manage/skills"
          onClick={onNavigate}
          className={({ isActive }) => {
            return cn("flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground");
          }}
        >
          <Sparkles className="size-4" /> Skills
        </NavLink>
        <NavLink
          to="/import"
          onClick={onNavigate}
          className={({ isActive }) => {
            return cn("flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground");
          }}
        >
          <FileUp className="size-4" /> Import
        </NavLink>
        <NavLink
          to="/manage/usage"
          onClick={onNavigate}
          className={({ isActive }) => {
            return cn("flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 hover:bg-muted", isActive && "bg-accent font-semibold text-accent-foreground");
          }}
        >
          <BarChart3 className="size-4" /> Usage
        </NavLink>
        <div className="flex items-center justify-between px-1">
          <div className="flex" role="group" aria-label="Theme">
            {THEMES.map(({ value, icon: Icon, label }) => {
              return (
                <Button key={value} variant="subtle" size="icon" aria-label={label} aria-pressed={theme === value} title={label} className={cn(theme === value && "bg-muted")} onClick={() => {
                  setTheme(value);
                }}
                >
                  <Icon />
                </Button>
              );
            })}
          </div>
          <Button variant="subtle" size="sm" onClick={() => {
            setKey("");
          }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
};

// Tells the person when any conversation needs them (see useNeedsYou). It draws nothing.
const NeedsYou = () => {
  useNeedsYou();
  return null;
};

export const Layout = () => {
  const key = useSelector(keyStore);
  const [open, setOpen] = useState(false);

  if (!key) {
    return <Gate />;
  }

  return (
    <div className="flex h-full">
      <NeedsYou />
      <aside className="hidden w-72 shrink-0 border-r md:block">
        <Sidebar onNavigate={() => {
          setOpen(false);
        }}
        />
      </aside>

      {open
        ? (
            <div className="fixed inset-0 z-40 md:hidden">
              <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => {
                setOpen(false);
              }}
              />
              <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r shadow-raised">
                <Sidebar onNavigate={() => {
                  setOpen(false);
                }}
                />
              </aside>
            </div>
          )
        : null}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 border-b bg-card px-2 py-1 md:hidden">
          <Button variant="subtle" size="icon" aria-label="Open menu" onClick={() => {
            setOpen(true);
          }}
          >
            {open ? <PanelLeftClose /> : <MenuIcon />}
          </Button>
          <span className="font-semibold">Torii</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
};
