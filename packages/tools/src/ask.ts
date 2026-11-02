import type { ToolSpec } from "./helpers.js";

// A question for the person, with options and room for their own words. It runs in the gateway, which shows it in the page and waits for
// the answer, so it is not one of the tools a device reports. With nobody to answer, the model is told so and must not guess.

export interface Question {
  question: string;
  options: string[];
}

export const readQuestion = (args: Record<string, unknown>): Question => {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (question === "") {
    throw new Error("\"question\" must be the question to ask, as text");
  }
  const raw = args.options ?? [];
  if (!Array.isArray(raw) || raw.length > 6 || raw.some((o) => {
    return typeof o !== "string" || o.trim() === "";
  })) {
    throw new Error("\"options\" must be a list of up to 6 short answers, as text");
  }
  return { question: question.slice(0, 1000), options: (raw as string[]).map((o) => {
    return o.trim().slice(0, 200);
  }) };
};

export const askTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "ask",
      description: "Ask the person a question and wait for the answer, when you need a decision only they can make. Give the likely answers as options; they can always answer in their own words. If nobody answers you are told so: do not guess, stop and say what you need to know.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question, in a sentence or two" },
          options: { type: "array", items: { type: "string" }, description: "Up to 6 likely answers" },
        },
        required: ["question"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "read",
  describe: (a) => {
    return typeof a.question === "string" ? `ask: ${a.question.slice(0, 80)}` : "ask a question";
  },
  run(a) {
    // The gateway answers this itself; here it only checks the arguments.
    return Promise.resolve().then(() => {
      return readQuestion(a).question;
    });
  },
};
