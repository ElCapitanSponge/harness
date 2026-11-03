import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRecord } from "@/lib/types";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string) => {
    return api(path) as Promise<unknown>;
  } };
});

const { ThisDevice } = await import("./ThisDevice");

const node = (nodeId: string, roots: string[] = ["proj"]): NodeRecord => {
  return { nodeId, kind: "local", busy: false, models: [], roots, lastSeen: 0 };
};

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
};

const show = (matched: string[], nodes: NodeRecord[] = [node("anakin"), node("bastila")]) => {
  api.mockImplementation((path: string) => {
    return Promise.resolve(path === "/whoami" ? { address: "100.64.0.7", devices: matched } : nodes);
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThisDevice onNavigate={() => {
          return undefined;
        }}
        />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

// The code option lives in the menu behind the split button's arrow.
const openMenu = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "More ways to start" }));
};

beforeEach(() => {
  localStorage.clear();
  api.mockReset();
});

describe("The New split button", () => {
  it("starts a conversation from its main part", async () => {
    show([]);
    await userEvent.click(await screen.findByRole("button", { name: /New conversation/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });

  it("offers a code session on the device the gateway matched, and goes to the start page with it chosen", async () => {
    show(["anakin"]);
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: /New code session here/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/?mode=code&device=anakin");
    expect(screen.getByText(/This device is anakin/)).toBeInTheDocument();
  });

  it("asks which device this is when nothing matched, and remembers the answer", async () => {
    const first = show([]);
    const select = await screen.findByLabelText("This device is");
    await screen.findByRole("option", { name: "bastila" });
    await userEvent.selectOptions(select, "bastila");
    expect(await screen.findByText(/This device is bastila/)).toBeInTheDocument();
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: /New code session here/ })).toBeInTheDocument();
    first.unmount();

    // Opened again, the page still knows.
    show([]);
    expect(await screen.findByText(/This device is bastila/)).toBeInTheDocument();
  });

  it("says there is no agent here, with the guide for the system of the browser, when the person says so", async () => {
    show(["anakin"]);
    await userEvent.click(await screen.findByRole("button", { name: "Not right?" }));
    expect(await screen.findByText(/There is no agent on this device/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /guide/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/docs/guides/") as string);
    await openMenu();
    // Another device has an agent, so a code session is still offered, just not "here".
    expect(await screen.findByRole("menuitem", { name: "New code session" })).toBeEnabled();
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: /New code session here/ })).not.toBeInTheDocument();
    });
  });

  it("turns the code option off, and says why, when no device has an agent", async () => {
    show([], [node("anakin", [])]);
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: /New code session/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/No device has an agent connected/)).toBeInTheDocument();
    await userEvent.click(item);
    expect(screen.getByTestId("where")).not.toHaveTextContent("mode=code");
  });
});
