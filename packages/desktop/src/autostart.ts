import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Starting at login. Windows and macOS have a login item Electron manages; on Linux (Ubuntu, Arch and the rest) an autostart entry in the
// user's config folder does the same for every desktop that follows the freedesktop standard.

export const linuxAutostartFile = (home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): string => {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, ".config");
  return path.join(base, "autostart", "torii.desktop");
};

// The text of the entry. The command is quoted for the Exec key, which treats spaces and a few characters specially.
export const linuxAutostartEntry = (execPath: string): string => {
  const quoted = `"${execPath.replace(/(["`$\\])/g, "\\$1")}"`;
  return ["[Desktop Entry]", "Type=Application", "Name=Torii", "Comment=Torii: your models and this device's files", `Exec=${quoted} --hidden`, "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
};

export const setLinuxAutostart = async (enabled: boolean, execPath: string, file: string = linuxAutostartFile()): Promise<void> => {
  if (enabled) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, linuxAutostartEntry(execPath), "utf8");
  } else {
    await fs.rm(file, { force: true });
  }
};

export const linuxAutostartEnabled = async (file: string = linuxAutostartFile()): Promise<boolean> => {
  return fs.access(file).then(() => {
    return true;
  }, () => {
    return false;
  });
};
