import type { PickedFile } from "./desktop";

// In a browser the page cannot browse the file system, but it can be given files: a file picker, read here as text. The same limits as the
// desktop app's: text only, and small enough to put in a message.

export const MAX_CONTEXT_FILE_BYTES = 200_000;

export const readTextFiles = async (files: File[]): Promise<PickedFile[]> => {
  const out: PickedFile[] = [];
  for (const file of files) {
    if (file.size > MAX_CONTEXT_FILE_BYTES) {
      out.push({ path: file.name, name: file.name, problem: `${file.name} is larger than ${String(MAX_CONTEXT_FILE_BYTES / 1000)} KB, too big to add to a message.` });
      continue;
    }
    const text = await file.text();
    out.push(text.includes("\u0000") ? { path: file.name, name: file.name, problem: `${file.name} looks like a binary file, not text.` } : { path: file.name, name: file.name, content: text });
  }
  return out;
};

// Opens the browser's file picker and reads what was chosen. Resolves with nothing if the picker is closed without a choice.
export const pickInBrowser = (): Promise<PickedFile[]> => {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => {
      void readTextFiles([...(input.files ?? [])]).then(resolve);
    });
    input.addEventListener("cancel", () => {
      resolve([]);
    });
    input.click();
  });
};
