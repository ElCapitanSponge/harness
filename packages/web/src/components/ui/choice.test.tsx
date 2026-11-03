import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Choice, type ChoiceGroup } from "./choice";

const groups: ChoiceGroup[] = [
  { options: [{ value: "a", label: "First", detail: "The first one" }, { value: "b", label: "Second", detail: "Cannot be chosen: busy", disabled: true }] },
  { label: "More", options: [{ value: "c", label: "Third", detail: "Careful", badge: "risky", badgeTone: "warning" }] },
];

const button = () => {
  return screen.getByRole("combobox", { name: "Pick" });
};

describe("Choice", () => {
  it("shows only the chosen label on the button, and in the list a second line, a badge, a check and the group of each option", async () => {
    render(<Choice label="Pick" groups={groups} value="c" onValueChange={vi.fn()} />);
    expect(button()).toHaveTextContent("Third");
    expect(button()).not.toHaveTextContent("Careful");

    await userEvent.click(button());
    const third = screen.getByRole("option", { name: "Third" });
    expect(third).toHaveAccessibleDescription("Careful");
    expect(third).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("option", { name: "First" })).toHaveAttribute("data-state", "unchecked");
    expect(within(third).getByText("risky")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "More" })).getByRole("option", { name: "Third" })).toBe(third);
  });

  it("chooses an option by clicking it, and closes", async () => {
    const onValueChange = vi.fn();
    render(<Choice label="Pick" groups={groups} value="a" onValueChange={onValueChange} />);
    await userEvent.click(button());
    await userEvent.click(screen.getByRole("option", { name: "Third" }));
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says in its second line why an option cannot be chosen, and does not let it be", async () => {
    const onValueChange = vi.fn();
    render(<Choice label="Pick" groups={groups} value="a" onValueChange={onValueChange} />);
    await userEvent.click(button());
    const second = screen.getByRole("option", { name: "Second" });
    expect(second).toHaveAttribute("aria-disabled", "true");
    expect(second).toHaveAccessibleDescription("Cannot be chosen: busy");
    await userEvent.click(second);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("works from the keyboard: Enter opens it, the arrows skip what cannot be chosen, Enter chooses", async () => {
    const onValueChange = vi.fn();
    render(<Choice label="Pick" groups={groups} value="a" onValueChange={onValueChange} />);
    button().focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without choosing", async () => {
    const onValueChange = vi.fn();
    render(<Choice label="Pick" groups={groups} value="a" onValueChange={onValueChange} />);
    await userEvent.click(button());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("cannot be opened while disabled", async () => {
    render(<Choice label="Pick" groups={groups} value="a" disabled onValueChange={vi.fn()} />);
    expect(button()).toBeDisabled();
    await userEvent.click(button());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
