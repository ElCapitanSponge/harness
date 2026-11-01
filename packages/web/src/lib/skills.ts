import type { SkillInfo } from "./types";

// The slash menu: typing / at the start of a message lists the skills, and a message that begins with a skill's name runs it with the
// rest of the text as its arguments. Kept free of React so it can be tested.

// What has been typed after the slash while it is still only a name (no space yet), or undefined when the menu should not show.
export const slashQuery = (text: string): string | undefined => {
  const match = /^\/([\w-]*)$/.exec(text);
  return match ? (match[1] ?? "") : undefined;
};

// The skills whose names start with the query, then those that contain it, then those whose description does.
export const matchSkills = (skills: SkillInfo[], query: string): SkillInfo[] => {
  const q = query.toLowerCase();
  const rank = (s: SkillInfo): number => {
    const name = s.name.toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : s.description.toLowerCase().includes(q) ? 2 : 3;
  };
  return skills.filter((s) => {
    return rank(s) < 3;
  }).sort((a, b) => {
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
};

// A message that starts with /name, where name is a skill that is there, is that skill run with the rest as its arguments.
export const parseSlash = (text: string, skills: SkillInfo[]): { name: string; arguments: string } | undefined => {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const name = match?.[1];
  if (!name || !skills.some((s) => {
    return s.name === name;
  })) {
    return undefined;
  }
  return { name, arguments: (match[2] ?? "").trim() };
};
