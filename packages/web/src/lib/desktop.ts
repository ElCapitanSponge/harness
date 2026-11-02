// The desktop app (docs/adr/0012-...) shows this same interface in its own window and tells the page, through `window.torii`, that it is
// running there, which device it is, and gives it the operating system's folder and file pickers. In a browser there is none of that.

export interface PickedFile {
  path: string;
  name: string;
  content?: string;
  problem?: string;
}

export interface DesktopApi {
  desktop: true;
  nodeId: string;
  platform: string;
  version: string;
  pickFolder: () => Promise<string | undefined>;
  pickFiles: () => Promise<PickedFile[]>;
  agent: {
    state: () => Promise<string>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  };
}

export const desktopApi = (): DesktopApi | undefined => {
  const api = (window as unknown as { torii?: Partial<DesktopApi> }).torii;
  return api?.desktop === true ? (api as DesktopApi) : undefined;
};

// The last part of a path on any system.
export const baseName = (file: string): string => {
  const parts = file.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? file;
};

// A name for a project folder from its path: letters, digits, dashes and dots.
export const rootNameFor = (folder: string): string => {
  const name = baseName(folder).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name === "" ? "project" : name;
};

// A file's text as a block to put in a message: its path, then the text in a code fence long enough not to be broken by backticks inside.
export const contextBlock = (label: string, content: string): string => {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => {
    return run.length;
  }));
  const fence = "`".repeat(longest + 1);
  return `${label}:\n${fence}\n${content.replace(/\n$/, "")}\n${fence}`;
};
