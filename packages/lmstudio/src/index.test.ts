import { describe, expect, it } from "vitest";
import { loadArgs, unloadArgs, validateContext, validateModel } from "./index.js";

describe("validateModel", () => {
  it("accepts the ids LM Studio uses", () => {
    for (const id of ["qwen3.5-9b", "google/gemma-4-12b-qat", "zai-org/glm-4.6v-flash", "lmstudio-community/Qwen3-8B-GGUF@q4_k_m", "model v1.5 (beta)"]) {
      expect(validateModel(id)).toBe(id);
    }
  });

  it("refuses anything that could be read as an option or break out of an argument", () => {
    for (const id of ["--help", "-y", "", " lead", "a;b", "a|b", "a&b", "a$b", "a`b", "a\nb", "x".repeat(201), 5, undefined, null]) {
      expect(() => validateModel(id), String(id)).toThrow("invalid model id");
    }
  });
});

describe("validateContext", () => {
  it("allows no value or a sensible whole number", () => {
    expect(validateContext(undefined)).toBeUndefined();
    expect(validateContext(null)).toBeUndefined();
    expect(validateContext(32768)).toBe(32768);
  });

  it("refuses fractions, tiny and huge values, and non-numbers", () => {
    for (const v of [1.5, 0, -5, 255, 4_000_001, "8192", NaN, Infinity]) {
      expect(() => validateContext(v), String(v)).toThrow("invalid context length");
    }
  });
});

describe("arguments", () => {
  it("builds load and unload arguments", () => {
    expect(loadArgs("m")).toEqual(["load", "m", "-y"]);
    expect(loadArgs("m", 4096)).toEqual(["load", "m", "-y", "-c", "4096"]);
    expect(unloadArgs("m")).toEqual(["unload", "m"]);
    expect(unloadArgs()).toEqual(["unload", "--all"]);
  });
});
