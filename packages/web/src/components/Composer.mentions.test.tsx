import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { Composer } = await import("./Composer");

const files: Record<string, string> = {
  ".": "src/\ndocs/\nREADME.md\n.git/",
  "src": "app.ts\nlib/",
  "src/lib": "util.ts",
};
const contents: Record<string, string> = {
  "src/app.ts": "1\tconsole.log(1);",
  "README.md": "1\t# Title",
  "bin.dat": "1\tab\u0000cd",
};

const respond = (_path: string, init?: { body?: { name: string; args: { path: string } } }): Promise<unknown> => {
  const body = init?.body;
  if (body?.name === "list_dir") {
    const listing = files[body.args.path];
    return Promise.resolve(listing === undefined ? { ok: false, output: "no such folder" } : { ok: true, output: listing });
  }
  if (body?.name === "read_file") {
    const text = contents[body.args.path];
    return Promise.resolve(text === undefined ? { ok: false, output: "no such file" } : { ok: true, output: text });
  }
  return Promise.resolve({ ok: false, output: "unknown" });
};

const show = (withProject = true, onSend = vi.fn()) => {
  const project = withProject ? { device: "pc", root: "proj" } : undefined;
  localStorage.clear();
  render(<Composer draftKey="t" busy={false} project={project} onSend={onSend} />);
  return { box: screen.getByLabelText<HTMLTextAreaElement>("Message"), onSend };
};

describe("@ mentions of project files", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation(respond);
  });

  it("lists the project's files when @ is typed and narrows them as the person types", async () => {
    const { box } = show();
    await userEvent.type(box, "look at @");
    expect(await screen.findByRole("option", { name: "docs/" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "README.md" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: ".git/" })).toBeNull();
    await userEvent.type(box, "re");
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "docs/" })).toBeNull();
    });
    expect(screen.getByRole("option", { name: "README.md" })).toBeInTheDocument();
  });

  it("completes a file with Enter, puts its path in the message and its text below as context", async () => {
    const { box, onSend } = show();
    await userEvent.type(box, "fix @src/a");
    await screen.findByRole("option", { name: "src/app.ts" });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(box.value).toContain("console.log(1);");
    });
    expect(box.value.startsWith("fix @src/app.ts ")).toBe(true);
    expect(box.value).toContain("src/app.ts:");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("goes into a folder when one is chosen, and keeps the menu open on what is inside", async () => {
    const { box } = show();
    await userEvent.type(box, "@sr");
    await userEvent.click(await screen.findByRole("option", { name: "src/" }));
    expect(box.value).toBe("@src/");
    expect(await screen.findByRole("option", { name: "src/lib/" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "src/app.ts" })).toBeInTheDocument();
  });

  it("moves with the arrow keys, and closes with Escape", async () => {
    const { box } = show();
    await userEvent.type(box, "@");
    await screen.findByRole("option", { name: "docs/" });
    expect(screen.getByRole("option", { name: "docs/" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "src/" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
  });

  it("says why a file could not be added, when it is binary", async () => {
    files["."] = "bin.dat";
    const { box } = show();
    await userEvent.type(box, "@bin");
    await userEvent.click(await screen.findByRole("option", { name: "bin.dat" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("looks like a binary file");
    files["."] = "src/\ndocs/\nREADME.md\n.git/";
  });

  it("offers nothing outside the project folder, and no menu without a project", async () => {
    const { box } = show();
    await userEvent.type(box, "@../");
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
    expect(api).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: expect.objectContaining({ args: { path: ".." } }) as unknown }));
  });

  it("is not offered in a chat with no project, and leaves an email address alone", async () => {
    const { box } = show(false);
    await userEvent.type(box, "@");
    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("leaves an address alone", async () => {
    const { box } = show();
    await userEvent.type(box, "me@exam");
    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
  });
});
