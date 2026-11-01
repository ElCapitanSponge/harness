import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedImport } from "@/lib/types";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { ImportView } = await import("./ImportView");

const show = () => {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ImportView /></MemoryRouter>
    </QueryClientProvider>,
  );
};

const split = (over: Partial<ParsedImport> = {}): ParsedImport => {
  return {
    format: "headings",
    split: true,
    conversations: [{ title: "Sorting", source: "pasted transcript", turns: [{ role: "user", text: "How?" }, { role: "assistant", text: "Like this." }] }],
    ...over,
  };
};

beforeEach(() => {
  api.mockReset();
});

describe("Import page", () => {
  it("shows how the paste was split, lets a wrongly assigned turn be fixed, and saves exactly what is shown", async () => {
    api.mockImplementation((path: string) => {
      return Promise.resolve(path === "/import/parse" ? split() : { id: "new-id" });
    });
    show();
    await userEvent.type(screen.getByLabelText("Paste a transcript"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Find the messages" }));

    expect(await screen.findByText("## User / ## Assistant headings")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Messages in Sorting" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.selectOptions(screen.getByLabelText("Who wrote message 2"), "user");
    await userEvent.click(screen.getByRole("button", { name: "Merge message 2 into the one before" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Import conversation" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/sessions/import", { method: "POST", body: { title: "Sorting", source: "pasted transcript", turns: [{ role: "user", text: "How?\n\nLike this." }] } });
    });
  });

  it("offers a text it cannot split as one message, with a way to split it by hand", async () => {
    api.mockResolvedValue(split({ format: "unsplit", split: false, conversations: [{ title: "notes", source: "pasted transcript", turns: [{ role: "user", text: "first part\n\nsecond part" }] }] }));
    show();
    await userEvent.type(screen.getByLabelText("Paste a transcript"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Find the messages" }));
    expect(await screen.findByText(/could not be split into turns/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Split at blank lines" }));
    const list = screen.getByRole("list", { name: "Messages in notes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByLabelText("Who wrote message 2")).toHaveValue("assistant");
  });

  it("lets several conversations in a file be picked, importing only the ticked ones", async () => {
    api.mockImplementation((path: string) => {
      return Promise.resolve(path === "/import/parse"
        ? split({ format: "chatgpt", conversations: [{ title: "One", source: "ChatGPT", turns: [{ role: "user", text: "a" }] }, { title: "Two", source: "ChatGPT", turns: [{ role: "user", text: "b" }] }] })
        : { id: "new-id" });
    });
    show();
    const input = screen.getByLabelText("Choose a file to import");
    await userEvent.upload(input, new File(["[]"], "conversations.json", { type: "application/json" }));
    expect(await screen.findByText("a ChatGPT export")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import conversation" })).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "Import Two" }));
    await userEvent.click(screen.getByRole("button", { name: "Import conversation" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/sessions/import", expect.objectContaining({ body: expect.objectContaining({ title: "Two" }) as unknown }));
    });
    expect(api).not.toHaveBeenCalledWith("/sessions/import", expect.objectContaining({ body: expect.objectContaining({ title: "One" }) as unknown }));
  });

  it("shows why a file could not be read", async () => {
    api.mockRejectedValue(new Error("that JSON is not a ChatGPT or Claude.ai export"));
    show();
    await userEvent.type(screen.getByLabelText("Paste a transcript"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Find the messages" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a ChatGPT or Claude.ai export");
  });
});
