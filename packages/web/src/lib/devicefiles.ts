import { api } from "@/lib/api";

// Reading a project folder on its device, read-only, through the same tool route the command line uses, so only what the device exposes
// to sessions can be seen.

export const deviceTool = async (device: string, root: string, name: string, args: Record<string, unknown>): Promise<string> => {
  const result = await api<{ ok: boolean; output: string }>(`/devices/${encodeURIComponent(device)}/tools`, { method: "POST", body: { root, name, args } });
  if (!result.ok) {
    throw new Error(result.output);
  }
  return result.output;
};

// read_file returns numbered lines ("12<tab>text") and may end with a note about the lines left out.
export const plainText = (numbered: string): { text: string; shortened: boolean } => {
  const lines = numbered.split("\n");
  const note = /^\[\.\.\. \d+ more lines?; use offset \d+\]$/;
  const shortened = lines.some((l) => {
    return note.test(l) || l.startsWith("[... truncated");
  });
  return {
    text: lines.filter((l) => {
      return !note.test(l) && !l.startsWith("[... truncated");
    }).map((l) => {
      return l.replace(/^\d+\t/, "");
    }).join("\n"),
    shortened,
  };
};
