import type { PermissionMode } from "@harness/core";

// How a conversation treats changes, in words for the person.
export const MODE_LABELS: Record<PermissionMode, string> = {
  ask: "ask before every change",
  edits: "accept file edits (commands still ask)",
  plan: "plan first (read-only until you approve the plan)",
  bypass: "run without asking",
};

export const MODE_OPTIONS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "ask", label: "Ask before every change", hint: "The default." },
  { value: "edits", label: "Accept file edits", hint: "Writes and edits go ahead; commands and everything else still ask." },
  { value: "plan", label: "Plan first", hint: "The model can only read until you approve its plan." },
  { value: "bypass", label: "Run without asking", hint: "Nothing asks. The device's own allow list still applies." },
];
