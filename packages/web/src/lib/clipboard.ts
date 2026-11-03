// navigator.clipboard exists only in a secure context (https or localhost), so over plain http on a LAN or Tailscale address it is
// missing and a bare call throws. copyText tries it first, then falls back to selecting a hidden text box and the older copy command.
// It says whether the text reached the clipboard, so a button can show that and not pretend.
const legacyCopy = (text: string): boolean => {
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "0";
  box.style.opacity = "0";
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  document.body.append(box);
  box.select();
  box.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to copy where navigator.clipboard is missing (plain http)
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  box.remove();
  before?.focus();
  return ok;
};

// The DOM types say the clipboard is always there; over plain http it is not, so the return type says so.
const clipboardApi = (): Clipboard | undefined => {
  return navigator.clipboard;
};

export const copyText = async (text: string): Promise<boolean> => {
  const api = clipboardApi();
  if (api !== undefined) {
    try {
      await api.writeText(text);
      return true;
    } catch {
      // Refused (no permission, or the page is not focused): try the older way.
    }
  }
  return legacyCopy(text);
};
