import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanDocument } from "./PlanDocument";

const copyText = vi.fn<(text: string) => Promise<boolean>>();
const saveText = vi.fn<(filename: string, text: string) => void>();
vi.mock("@/lib/clipboard", () => {
  return { copyText: (text: string) => {
    return copyText(text);
  } };
});
vi.mock("@/lib/download", () => {
  return { saveText: (filename: string, text: string) => {
    saveText(filename, text);
  } };
});

beforeEach(() => {
  copyText.mockReset().mockResolvedValue(true);
  saveText.mockReset();
});

const one = [{ version: 1, markdown: "# Plan\n\n- fix it", by: "model" as const }];
const two = [...one, { version: 2, markdown: "# Plan\n\n- fix it\n- test it", by: "person" as const }];

describe("the plan document in the panel", () => {
  it("shows the plan rendered as markdown", () => {
    render(<PlanDocument versions={one} />);
    expect(screen.getByRole("heading", { name: "Plan", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("fix it")).toBeInTheDocument();
    expect(screen.queryByLabelText("Older version")).not.toBeInTheDocument();
  });

  it("copies the text, and says so, or says it could not", async () => {
    render(<PlanDocument versions={one} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith("# Plan\n\n- fix it");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says when it could not copy", async () => {
    copyText.mockResolvedValue(false);
    render(<PlanDocument versions={one} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Could not copy" })).toBeInTheDocument();
  });

  it("saves it as plan.md, or plan-vN.md when there are versions", async () => {
    const first = render(<PlanDocument versions={one} />);
    await userEvent.click(screen.getByRole("button", { name: "Download .md" }));
    expect(saveText).toHaveBeenLastCalledWith("plan.md", "# Plan\n\n- fix it");
    first.unmount();

    render(<PlanDocument versions={two} />);
    await userEvent.click(screen.getByRole("button", { name: "Download .md" }));
    expect(saveText).toHaveBeenLastCalledWith("plan-v2.md", "# Plan\n\n- fix it\n- test it");
  });

  it("shows the latest version, with the earlier ones a step back, and says who wrote each", async () => {
    render(<PlanDocument versions={two} />);
    expect(screen.getByText("Version 2 of 2, edited by you")).toBeInTheDocument();
    expect(screen.getByText("test it")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newer version" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Older version" }));
    expect(screen.getByText("Version 1 of 2, written by the model")).toBeInTheDocument();
    expect(screen.queryByText("test it")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Older version" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Newer version" }));
    expect(screen.getByText("Version 2 of 2, edited by you")).toBeInTheDocument();
  });

  it("follows a new version when it arrives, unless the person is reading an earlier one", async () => {
    const view = render(<PlanDocument versions={one} />);
    view.rerender(<PlanDocument versions={two} />);
    expect(screen.getByText("Version 2 of 2, edited by you")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Older version" }));
    view.rerender(<PlanDocument versions={[...two, { version: 3, markdown: "# Plan\n\n- again", by: "model" }]} />);
    expect(screen.getByText("Version 1 of 3, written by the model")).toBeInTheDocument();
  });
});
