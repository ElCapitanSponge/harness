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
