import { ApiError, authHeaders } from "./api";

// Fetches a conversation as markdown (the request carries the sign-in) and hands it to the browser as a file to save.
export const downloadExport = async (id: string, title: string): Promise<void> => {
  const res = await fetch(`/sessions/${id}/export`, { headers: authHeaders() });
  if (!res.ok) {
    throw new ApiError(res.status, "could not export");
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^\w -]+/g, "").trim().slice(0, 60) || "conversation"}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// A skill from the gateway's library as a zip, handed to the browser to save.
export const downloadSkill = async (name: string): Promise<void> => {
  const res = await fetch(`/library/skills/${encodeURIComponent(name)}/export`, { headers: authHeaders() });
  if (!res.ok) {
    throw new ApiError(res.status, "could not export");
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// Text the page already has (a plan document), handed to the browser as a file to save. Nothing is fetched.
export const saveText = (filename: string, text: string, type = "text/markdown"): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
