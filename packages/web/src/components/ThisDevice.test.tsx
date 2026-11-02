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

const node = (nodeId: string): NodeRecord => {
  return { nodeId, kind: "local", busy: false, models: [], roots: ["proj"], lastSeen: 0 };
};

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
};

const show = (matched: string[]) => {
  api.mockImplementation((path: string) => {
    return Promise.resolve(path === "/whoami" ? { address: "100.64.0.7", devices: matched } : [node("anakin"), node("bastila")]);
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

beforeEach(() => {
  localStorage.clear();
  api.mockReset();
});

describe("This device", () => {
  it("offers a code session on the device the gateway matched, and goes to the start page with it chosen", async () => {
    show(["anakin"]);
    await userEvent.click(await screen.findByRole("button", { name: /New code session here/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/?mode=code&device=anakin");
    expect(screen.getByText(/This device is anakin/)).toBeInTheDocument();
  });

  it("asks which device this is when nothing matched, and remembers the answer", async () => {
    const first = show([]);
    const select = await screen.findByLabelText("This device is");
    await screen.findByRole("option", { name: "bastila" });
    await userEvent.selectOptions(select, "bastila");
    expect(await screen.findByRole("button", { name: /New code session here/ })).toBeInTheDocument();
    expect(screen.getByText(/This device is bastila/)).toBeInTheDocument();
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
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /New code session here/ })).not.toBeInTheDocument();
    });
  });
});
