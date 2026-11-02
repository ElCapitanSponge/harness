import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { LibrarySkill } from "@/lib/types";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { LibraryPanel } = await import("./LibraryPanel");

const skill = (name: string, over: Partial<LibrarySkill> = {}): LibrarySkill => {
  return { name, description: `About ${name}.`, length: 100, modelInvocable: true, source: "library", files: 2, bytes: 2048, ...over };
};

const show = () => {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LibraryPanel />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  api.mockReset();
});

describe("Library panel", () => {
  it("lists the library's skills with their size, and says when it is empty", async () => {
    api.mockResolvedValue([skill("tdd"), skill("quiet", { modelInvocable: false, files: 1, bytes: 300 })]);
    show();
    const list = await screen.findByRole("list", { name: "Library skills" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("2 files, 2.0 KB")).toBeInTheDocument();
    expect(within(list).getByText("1 file, 300 bytes")).toBeInTheDocument();
    expect(within(list).getByText("you start it")).toBeInTheDocument();
  });

  it("says the library is empty", async () => {
    api.mockResolvedValue([]);
    show();
    expect(await screen.findByText("The library is empty.")).toBeInTheDocument();
  });

  it("adds a chosen zip, sending it as base64", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      return Promise.resolve(init?.method === "POST" ? skill("tdd") : []);
    });
    show();
    await userEvent.upload(screen.getByLabelText("Choose a skill zip"), new File([new Uint8Array([80, 75, 3, 4])], "tdd.zip", { type: "application/zip" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/library/skills", { method: "POST", body: { zip: "UEsDBA==" } });
    });
  });

  it("adds the files of a chosen folder with their paths", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      return Promise.resolve(init?.method === "POST" ? skill("tdd") : []);
    });
    show();
    const a = new File(["---"], "SKILL.md");
    Object.defineProperty(a, "webkitRelativePath", { value: "tdd/SKILL.md" });
    await userEvent.upload(screen.getByLabelText("Choose a skill folder"), [a]);
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/library/skills", { method: "POST", body: { files: [{ path: "tdd/SKILL.md", data: "LS0t" }] } });
    });
  });

  it("offers to replace a skill that is already there, and sends it again as a replacement only on a yes", async () => {
    api.mockImplementation((path: string, init?: { method?: string; body?: { overwrite?: boolean } }) => {
      if (init?.method !== "POST") {
        return Promise.resolve([]);
      }
      return init.body?.overwrite === true ? Promise.resolve(skill("tdd")) : Promise.reject(new ApiError(409, "the library already has a skill named \"tdd\""));
    });
    show();
    await userEvent.upload(screen.getByLabelText("Choose a skill zip"), new File([new Uint8Array([1])], "tdd.zip", { type: "application/zip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has a skill named \"tdd\"");
    await userEvent.click(screen.getByRole("button", { name: "Replace it" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/library/skills", { method: "POST", body: { zip: "AQ==", overwrite: true } });
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Replace it" })).not.toBeInTheDocument();
    });
  });

  it("shows why a skill was refused, and refuses a zip that is too big without sending it", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      return init?.method === "POST" ? Promise.reject(new ApiError(422, "there is no SKILL.md at the top of that skill")) : Promise.resolve([]);
    });
    show();
    await userEvent.upload(screen.getByLabelText("Choose a skill zip"), new File([new Uint8Array([1])], "x.zip", { type: "application/zip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no SKILL.md");

    api.mockClear();
    await userEvent.upload(screen.getByLabelText("Choose a skill zip"), new File([new Uint8Array(6 * 1024 * 1024)], "big.zip", { type: "application/zip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("big.zip is larger than 5 MB.");
    expect(api).not.toHaveBeenCalledWith("/library/skills", expect.objectContaining({ method: "POST" }));
  });

  it("removes a skill", async () => {
    api.mockImplementation((path: string, init?: { method?: string }) => {
      return Promise.resolve(init?.method === "DELETE" ? { ok: true } : [skill("tdd")]);
    });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Remove tdd from the library" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/library/skills/tdd", { method: "DELETE" });
    });
  });
});
