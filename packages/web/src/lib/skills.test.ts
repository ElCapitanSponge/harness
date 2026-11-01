import { describe, expect, it } from "vitest";
import { matchSkills, parseSlash, slashQuery } from "./skills";
import type { SkillInfo } from "./types";

const skill = (name: string, description = "A skill."): SkillInfo => {
  return { name, description, length: 100, modelInvocable: true, source: "user" };
};

const skills = [skill("tdd", "Test-driven development."), skill("triage", "Sort the issues."), skill("setup-pre-commit", "Hooks that run tdd checks."), skill("wizard")];

const names = (list: SkillInfo[]): string[] => {
  return list.map((s) => {
    return s.name;
  });
};

describe("the slash menu", () => {
  it("opens while the first word is a slash and a name being typed, and not after a space", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/td")).toBe("td");
    expect(slashQuery("/tdd ")).toBeUndefined();
    expect(slashQuery("hello /tdd")).toBeUndefined();
    expect(slashQuery("")).toBeUndefined();
  });

  it("lists names that start with what was typed first, then those that contain it, then by description", () => {
    expect(names(matchSkills(skills, "t"))).toEqual(["tdd", "triage", "setup-pre-commit"]);
    expect(matchSkills(skills, "")).toHaveLength(4);
    expect(names(matchSkills(skills, "pre"))).toEqual(["setup-pre-commit"]);
    expect(matchSkills(skills, "zzz")).toEqual([]);
  });
});

describe("running a skill from a message", () => {
  it("takes the rest of the text, over any number of lines, as the arguments", () => {
    expect(parseSlash("/tdd the parser", skills)).toEqual({ name: "tdd", arguments: "the parser" });
    expect(parseSlash("/tdd\nline one\nline two", skills)).toEqual({ name: "tdd", arguments: "line one\nline two" });
    expect(parseSlash("/wizard", skills)).toEqual({ name: "wizard", arguments: "" });
  });

  it("leaves a message alone when the name is not a skill that is there", () => {
    expect(parseSlash("/nope hello", skills)).toBeUndefined();
    expect(parseSlash("tell me about /tdd", skills)).toBeUndefined();
    expect(parseSlash("/tdd", [])).toBeUndefined();
  });
});
