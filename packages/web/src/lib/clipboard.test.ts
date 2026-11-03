import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

const setClipboard = (writeText: (text: string) => Promise<void>): void => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
};

// jsdom has no execCommand; this stands in for it and records what was selected when it ran.
const setExecCommand = (run: () => boolean): { copied: string[] } => {
  const copied: string[] = [];
  Object.defineProperty(document, "execCommand", {
    value: (command: string): boolean => {
      expect(command).toBe("copy");
      copied.push(document.querySelector("textarea")?.value ?? "");
      return run();
    },
    configurable: true,
    writable: true,
  });
  return { copied };
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  document.body.replaceChildren();
});

describe("copyText", () => {
  it("uses the clipboard API when the page has one", async () => {
    const writeText = vi.fn(() => {
      return Promise.resolve();
    });
    setClipboard(writeText);
    const old = setExecCommand(() => {
      return true;
    });

    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(old.copied).toEqual([]);
  });

  it("falls back to the older copy command where there is no clipboard API (plain http)", async () => {
    const old = setExecCommand(() => {
      return true;
    });

    expect(await copyText("over http")).toBe(true);
    expect(old.copied).toEqual(["over http"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the clipboard API refuses", async () => {
    setClipboard(() => {
      return Promise.reject(new Error("denied"));
    });
    const old = setExecCommand(() => {
      return true;
    });

    expect(await copyText("refused")).toBe(true);
    expect(old.copied).toEqual(["refused"]);
  });

  it("says false when the older copy command reports failure", async () => {
    setExecCommand(() => {
      return false;
    });

    expect(await copyText("x")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("says false when the older copy command throws", async () => {
    setExecCommand(() => {
      throw new Error("not allowed");
    });

    expect(await copyText("x")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("says false when neither way exists", async () => {
    expect(await copyText("x")).toBe(false);
  });

  it("puts the focus back where it was", async () => {
    setExecCommand(() => {
      return true;
    });
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    await copyText("x");

    expect(document.activeElement).toBe(button);
  });
});
