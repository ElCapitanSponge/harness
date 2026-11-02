import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillInfo } from "@/lib/types";
import { Composer } from "./Composer";

const skill = (name: string): SkillInfo => {
  return { name, description: `Does ${name}`, length: 10, modelInvocable: true, source: "project" };
};

const show = (skills: SkillInfo[] | undefined = [skill("review")]) => {
  localStorage.clear();
  const onSend = vi.fn();
  const onCommand = vi.fn();
  render(<Composer draftKey="c" busy={false} skills={skills} onCommand={onCommand} onSend={onSend} />);
  return { box: screen.getByLabelText<HTMLTextAreaElement>("Message"), onSend, onCommand };
};

describe("built-in slash commands in the message box", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lists the commands with a description before the skills, marked as commands", async () => {
    const { box } = show();
    await userEvent.type(box, "/");
    const names = screen.getAllByRole("option").map((o) => {
      return o.querySelector("span")?.textContent;
    });
    expect(names).toEqual(["/clear", "/compact", "/init", "/model", "/permissions", "/review"]);
    expect(screen.getByText("Summarise the older turns of this conversation now")).toBeInTheDocument();
    expect(screen.getAllByText("command")).toHaveLength(5);
  });

  it("filters as the person types, and completes with Enter", async () => {
    const { box, onCommand } = show();
    await userEvent.type(box, "/perm");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(box.value).toBe("/permissions ");
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("runs a command instead of sending it, with its arguments, and clears the box", async () => {
    const { box, onSend, onCommand } = show();
    await userEvent.type(box, "/model qwen{Enter}");
    expect(onCommand).toHaveBeenCalledWith("model", "qwen");
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("");
  });

  it("completes a command that takes an argument, and runs it when its whole name was already typed", async () => {
    const { box, onCommand } = show();
    await userEvent.type(box, "/mod{Enter}");
    expect(box.value).toBe("/model ");
    expect(onCommand).not.toHaveBeenCalled();
    await userEvent.clear(box);
    await userEvent.type(box, "/model{Enter}");
    expect(onCommand).toHaveBeenCalledWith("model", "");
  });

  it("runs a command with no arguments", async () => {
    const { box, onCommand } = show();
    await userEvent.type(box, "/compact{Enter}");
    expect(onCommand).toHaveBeenCalledWith("compact", "");
  });

  it("still sends a skill, and an ordinary message, as they were", async () => {
    const { box, onSend, onCommand } = show();
    await userEvent.type(box, "/review the diff{Enter}");
    expect(onSend).toHaveBeenCalledWith("/review the diff");
    await userEvent.type(box, "please /compact{Enter}");
    expect(onSend).toHaveBeenLastCalledWith("please /compact");
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("lists the commands even where there are no skills", async () => {
    const { box } = show(undefined);
    await userEvent.type(box, "/cl");
    expect(screen.getByRole("option", { name: /clear/ })).toBeInTheDocument();
  });

  it("does not list commands where the page cannot run them", async () => {
    localStorage.clear();
    render(<Composer draftKey="d" busy={false} skills={[skill("review")]} onSend={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "/");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
