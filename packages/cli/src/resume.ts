import type { SessionInfo } from "@harness/core";

export interface Wanted {
  // An id, or the start of one, from `harness sessions`.
  resume?: string;
  // The newest coding session, in the given device and root if there are any.
  continue?: boolean;
  device?: string;
  root?: string;
}

// The coding session to go back to, or an error in words.
export const pickSession = (sessions: SessionInfo[], wanted: Wanted): SessionInfo => {
  if (wanted.resume) {
    const id = wanted.resume;
    const found = sessions.filter((s) => {
      return s.kind === "code" && s.id.startsWith(id);
    });
    const [only] = found;
    if (!only) {
      throw new Error(`no coding session starts with "${id}" (see: harness sessions)`);
    }
    if (found.length > 1) {
      throw new Error(`"${id}" fits ${String(found.length)} sessions; give more of the id`);
    }
    return only;
  }
  const newest = sessions.filter((s) => {
    return s.kind === "code" && (!wanted.device || s.device === wanted.device) && (!wanted.root || s.root === wanted.root);
  }).sort((a, b) => {
    return b.updated - a.updated;
  })[0];
  if (!newest) {
    throw new Error("there is no coding session to continue here");
  }
  return newest;
};
