import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { ApiError } = await import("@/lib/api");
const { ProjectMemory } = await import("./ProjectMemory");

interface Body { text: string; version: string }

// What the device has: the files, which a save changes, so the page's next read sees it.
let disk: Record<string, { text: string; version: string } | undefined>;
let saves: { path: string; body: Body }[];

const length = (name: string): number => {
  return disk[name]?.text.length ?? 0;
};

beforeEach(() => {
  disk = { "AGENTS.md": { text: "Use pnpm.", version: "1-9" } };
  saves = [];
  api.mockReset();
  api.mockImplementation((path: string, init?: { method?: string; body?: Body }) => {
    if (path === "/sessions/s1/instructions") {
      return Promise.resolve(["AGENTS.md", "CLAUDE.md"].map((name) => {
        return disk[name] ? { name, exists: true, length: length(name) } : { name, exists: false };
      }));
    }
    const name = path.split("/").pop() ?? "";
    if (init?.method === "PUT" && init.body) {
      saves.push({ path, body: init.body });
      if (init.body.version !== (disk[name]?.version ?? "absent")) {
        return Promise.reject(new ApiError(409, `${name} changed on disk after you opened it; reload it to see what changed`));
      }
      const version = `v${String(saves.length)}`;
      disk[name] = { text: init.body.text, version };
      return Promise.resolve({ saved: true, version, length: init.body.text.length });
    }
    const file = disk[name];
    return Promise.resolve({ name, exists: file !== undefined, text: file?.text ?? "", version: file?.version ?? "absent" });
  });
});

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProjectMemory id="s1" /></QueryClientProvider>);
};

const box = (name: string) => {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: `${name} text` });
};

describe("Project memory", () => {
  it("lists the files that exist with their length, and says why one cannot be opened", async () => {
    api.mockReset();
    api.mockResolvedValue([{ name: "AGENTS.md", exists: true, length: 10 }, { name: "CLAUDE.md", note: "CLAUDE.md is too long to edit here (30000 characters); edit it on the device" }]);
    show();
    const row = await screen.findByRole("button", { name: /AGENTS\.md.*10 characters/ });
    // A touch target is at least 44 pixels (11 rem units of 4) tall on a touchscreen.
    expect(row.className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByText(/too long to edit here/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create AGENTS/ })).toBeNull();
  });

  it("shows nothing for a conversation with no project folder", async () => {
    api.mockReset();
    api.mockResolvedValue([]);
    show();
    await waitFor(() => {
      expect(api).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Project memory" })).toBeNull();
    });
  });

  it("opens a file to edit, saves it with the version it was opened at, and says when the change applies", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /AGENTS\.md/ }));
    expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "AGENTS.md text" })).value).toBe("Use pnpm.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    await user.type(box("AGENTS.md"), " Run the tests.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Saved\./)).toBeTruthy();
    expect(screen.getByText(/next message/)).toBeTruthy();
    expect(saves).toEqual([{ path: "/sessions/s1/instructions/AGENTS.md", body: { text: "Use pnpm. Run the tests.", version: "1-9" } }]);
    expect(disk["AGENTS.md"]?.text).toBe("Use pnpm. Run the tests.");
  });

  it("saves again straight away against the version the first save gave, not as a conflict", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /AGENTS\.md/ }));
    await screen.findByRole("textbox", { name: "AGENTS.md text" });
    await user.type(box("AGENTS.md"), " One.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved\./);
    await user.type(box("AGENTS.md"), " Two.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saves).toHaveLength(2);
    });
    expect(saves[1]?.body).toEqual({ text: "Use pnpm. One. Two.", version: "v1" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps what was typed when the file changed on the device, and reloads only when asked", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /AGENTS\.md/ }));
    await screen.findByRole("textbox", { name: "AGENTS.md text" });
    await user.type(box("AGENTS.md"), " Mine.");
    disk["AGENTS.md"] = { text: "Changed elsewhere.", version: "9-18" };
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed on disk after you opened it/)).toBeTruthy();
    expect(screen.getByText(/Your text is still here/)).toBeTruthy();
    expect(box("AGENTS.md").value).toBe("Use pnpm. Mine.");
    expect(disk["AGENTS.md"].text).toBe("Changed elsewhere.");

    await user.click(screen.getByRole("button", { name: "Reload from the device" }));
    await waitFor(() => {
      expect(box("AGENTS.md").value).toBe("Changed elsewhere.");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    expect(saves).toHaveLength(1);
  });

  it("offers to create AGENTS.md when the project has none, and saves it as a new file", async () => {
    disk = {};
    const user = userEvent.setup();
    show();
    expect(await screen.findByText("This project has no instruction file yet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Create AGENTS\.md/ }));
    expect(await screen.findByText("AGENTS.md (new)")).toBeTruthy();
    expect(box("AGENTS.md").value).toBe("");
    await user.type(box("AGENTS.md"), "# Rules");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved\./);
    expect(saves[0]?.body).toEqual({ text: "# Rules", version: "absent" });
    expect(disk["AGENTS.md"]?.text).toBe("# Rules");
  });

  it("does not offer a new AGENTS.md when CLAUDE.md is already there", async () => {
    disk = { "CLAUDE.md": { text: "Be kind.", version: "1-8" } };
    show();
    expect(await screen.findByRole("button", { name: /CLAUDE\.md.*8 characters/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create AGENTS/ })).toBeNull();
    expect(screen.queryByText("This project has no instruction file yet.")).toBeNull();
  });

  it("shows the reason when the device refuses a save, keeps the text, and offers no reload", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /AGENTS\.md/ }));
    await screen.findByRole("textbox", { name: "AGENTS.md text" });
    await user.type(box("AGENTS.md"), " More.");
    api.mockRejectedValueOnce(new ApiError(403, "project root \"proj\" is read-only on this device, so write_instruction is not allowed there"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/is read-only on this device/)).toBeTruthy();
    expect(box("AGENTS.md").value).toBe("Use pnpm. More.");
    expect(screen.queryByRole("button", { name: "Reload from the device" })).toBeNull();
  });

  it("says so when the device cannot be reached", async () => {
    api.mockReset();
    api.mockRejectedValue(new ApiError(503, "Could not reach the device: not connected"));
    show();
    expect(await screen.findByText("Could not reach the device: not connected")).toBeTruthy();
  });

  it("goes back to the list from an open file", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /AGENTS\.md/ }));
    await screen.findByRole("textbox", { name: "AGENTS.md text" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /AGENTS\.md.*9 characters/ })).toBeTruthy();
  });
});
