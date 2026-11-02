import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { PermissionsView } = await import("./PermissionsView");

const show = () => {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PermissionsView />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  api.mockReset();
});

describe("Permissions page", () => {
  it("lists the remembered rules and removes one", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      return Promise.resolve(init?.method === "DELETE" ? { ok: true } : [{ id: 7, device: "anakin", root: "proj", tool: "run_command", created: 1 }]);
    });
    show();
    const list = await screen.findByRole("list", { name: "Remembered rules" });
    expect(within(list).getByText("run_command")).toBeInTheDocument();
    expect(within(list).getByText(/always allowed in anakin:proj/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove the rule for run_command in anakin:proj" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/rules/7", { method: "DELETE" });
    });
  });

  it("says how to add one when none is remembered", async () => {
    api.mockResolvedValue([]);
    show();
    expect(await screen.findByText(/Nothing is remembered/)).toBeInTheDocument();
  });
});
