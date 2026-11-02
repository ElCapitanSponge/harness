import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { NewConversation } = await import("./NewConversation");

let roots = ["app"];
const answer = (path: string, init?: { method?: string; body?: { projectRoots?: Record<string, string> } }): Promise<unknown> => {
  if (path === "/nodes") {
    return Promise.resolve([{ nodeId: "anakin", kind: "local", busy: false, models: [], roots, lastSeen: 0 }]);
  }
  if (path === "/devices/anakin/settings") {
    if (init?.method === "PUT") {
      roots = Object.keys(init.body?.projectRoots ?? {});
      return Promise.resolve({});
    }
    return Promise.resolve({ settings: { projectRoots: { app: "C:/work/app" } }, sources: {}, locked: [], remoteConfig: true });
  }
  if (path === "/catalogue") {
    return Promise.resolve({ models: [], claude: { available: false, models: [] } });
  }
  return Promise.resolve([]);
};

const show = () => {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/?mode=code"]}>
        <NewConversation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("choosing the working folder when starting a code session", () => {
  beforeEach(() => {
    roots = ["app"];
    api.mockReset();
    api.mockImplementation(answer);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "torii");
  });

  it("offers the project folders already set up on each device, and no picker, in a browser", async () => {
    show();
    expect(await screen.findByRole("option", { name: "app" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choose a folder/ })).toBeNull();
  });

  it("in the desktop app, uses the system picker, adds the folder to this machine and selects it", async () => {
    const pickFolder = vi.fn(() => {
      return Promise.resolve("C:\\work\\site");
    });
    Object.defineProperty(window, "torii", { configurable: true, value: { desktop: true, nodeId: "anakin", platform: "win32", version: "1", pickFolder, pickFiles: vi.fn(), agent: {} } });
    show();
    await userEvent.click(await screen.findByRole("button", { name: /Choose a folder/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Project folder" })).toHaveValue("site");
    });
    expect(api).toHaveBeenCalledWith("/devices/anakin/settings", { method: "PUT", body: { projectRoots: { app: "C:/work/app", site: "C:\\work\\site" } } });
  });

  it("does nothing when the picker is closed without a choice", async () => {
    Object.defineProperty(window, "torii", { configurable: true, value: { desktop: true, nodeId: "anakin", platform: "win32", version: "1", pickFolder: vi.fn(() => {
      return Promise.resolve(undefined);
    }), pickFiles: vi.fn(), agent: {} } });
    show();
    await userEvent.click(await screen.findByRole("button", { name: /Choose a folder/ }));
    expect(api).not.toHaveBeenCalledWith("/devices/anakin/settings", expect.objectContaining({ method: "PUT" }));
  });

  it("says in words when the folder could not be added", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/devices/anakin/settings" && init?.method === "PUT") {
        return Promise.reject(new Error("refused"));
      }
      return answer(path);
    });
    Object.defineProperty(window, "torii", { configurable: true, value: { desktop: true, nodeId: "anakin", platform: "win32", version: "1", pickFolder: vi.fn(() => {
      return Promise.resolve("C:/work/site");
    }), pickFiles: vi.fn(), agent: {} } });
    show();
    await userEvent.click(await screen.findByRole("button", { name: /Choose a folder/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The device would not accept the folder: refused");
  });
});
