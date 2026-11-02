import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { FileBrowser, parentOf, plainText } = await import("./FileBrowser");

const listing: Record<string, string> = {
  ".": "docs/\nsrc/\nREADME.md\npackage.json",
  "src": "util/\nindex.ts",
  "src/util": "(empty)",
};

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path: string, init?: { body?: { name: string; args: { path: string } } }) => {
    const body = init?.body;
    if (body?.name === "list_dir") {
      return Promise.resolve({ ok: true, output: listing[body.args.path] ?? "(empty)" });
    }
    if (body?.name === "read_file" && body.args.path === "src/index.ts") {
      return Promise.resolve({ ok: true, output: "1\texport const a = 1;\n2\t" });
    }
    return Promise.resolve({ ok: false, output: "path is outside the working directory" });
  });
});

describe("reading a file for a message", () => {
  it("takes the numbers off the lines of read_file, and says if the file was shortened", () => {
    expect(plainText("1\ta\n2\tb")).toEqual({ text: "a\nb", shortened: false });
    expect(plainText("1\ta\n[... 40 more lines; use offset 2]")).toEqual({ text: "a", shortened: true });
    expect(plainText("1\ta\n[... truncated 500 characters]")).toEqual({ text: "a", shortened: true });
  });

  it("finds the folder above", () => {
    expect(parentOf("src/util")).toBe("src");
    expect(parentOf("src")).toBe("");
    expect(parentOf("")).toBe("");
  });
});

describe("File browser", () => {
  it("lists a project folder through the device's read-only tools and opens folders", async () => {
    render(<FileBrowser device="anakin" root="proj" onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Browse proj" }));
    expect(await screen.findByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/devices/anakin/tools", { method: "POST", body: { root: "proj", name: "list_dir", args: { path: "." } } });

    await userEvent.click(screen.getByRole("button", { name: "src/" }));
    expect(await screen.findByRole("button", { name: "index.ts" })).toBeInTheDocument();
    expect(screen.getByText("/src")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Up one folder" }));
    expect(await screen.findByRole("button", { name: "README.md" })).toBeInTheDocument();
  });

  it("adds a file's text to the message when it is chosen", async () => {
    const onAdd = vi.fn();
    render(<FileBrowser device="anakin" root="proj" onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Browse proj" }));
    await userEvent.click(await screen.findByRole("button", { name: "src/" }));
    await userEvent.click(await screen.findByRole("button", { name: "index.ts" }));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("src/index.ts", "export const a = 1;\n", false);
    });
  });

  it("says when the device refused, and says an empty folder is empty", async () => {
    render(<FileBrowser device="anakin" root="proj" onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Browse proj" }));
    await userEvent.click(await screen.findByRole("button", { name: "src/" }));
    await userEvent.click(await screen.findByRole("button", { name: "util/" }));
    expect(await screen.findByText("This folder is empty.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Up one folder" }));
    await userEvent.click(await screen.findByRole("button", { name: "index.ts" }));
    api.mockResolvedValueOnce({ ok: false, output: "file looks binary" });
    await userEvent.click(screen.getByRole("button", { name: "index.ts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("file looks binary");
  });
});
