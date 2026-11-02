// Turns what the person chose into what the gateway takes for a library skill: a zip (as base64), or the files of a folder. The limits
// are the gateway's own, checked here first so a skill that is too big is refused before it is uploaded.

export const MAX_SKILL_FILES = 100;
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;
export const MAX_SKILL_BYTES = 5 * 1024 * 1024;

const base64 = (file: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => {
      reject(new Error("could not read the file"));
    };
    reader.readAsDataURL(file);
  });
};

export type SkillUpload = { zip: string } | { files: { path: string; data: string }[] };

// One zip file, or the files of a chosen folder (each with the path the browser gives it, `folder/SKILL.md`).
export const readSkillUpload = async (files: File[]): Promise<SkillUpload> => {
  const first = files[0];
  if (!first) {
    throw new Error("Nothing was chosen.");
  }
  if (files.length === 1 && (first.name.toLowerCase().endsWith(".zip") || first.type === "application/zip")) {
    if (first.size > MAX_SKILL_BYTES) {
      throw new Error(`${first.name} is larger than ${String(MAX_SKILL_BYTES / 1024 / 1024)} MB.`);
    }
    return { zip: await base64(first) };
  }
  if (files.length > MAX_SKILL_FILES) {
    throw new Error(`A skill may have up to ${String(MAX_SKILL_FILES)} files; that folder has ${String(files.length)}.`);
  }
  const big = files.find((f) => {
    return f.size > MAX_SKILL_FILE_BYTES;
  });
  if (big) {
    throw new Error(`${big.name} is larger than ${String(MAX_SKILL_FILE_BYTES / 1024 / 1024)} MB.`);
  }
  if (files.reduce((sum, f) => {
    return sum + f.size;
  }, 0) > MAX_SKILL_BYTES) {
    throw new Error(`A skill may be up to ${String(MAX_SKILL_BYTES / 1024 / 1024)} MB in all.`);
  }
  return {
    files: await Promise.all(files.map(async (f) => {
      const relative = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
      return { path: relative && relative !== "" ? relative : f.name, data: await base64(f) };
    })),
  };
};
