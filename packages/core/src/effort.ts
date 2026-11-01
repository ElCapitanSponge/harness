// How hard a model is asked to think, for the models that can be told. This file has no dependencies, so the web app can use it
// without pulling in the rest of core.

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// The levels a model can be set to, or none if it cannot be. Claude takes all five (the claude program's --effort). The open
// gpt-oss models take low, medium and high through the reasoning effort setting. Other models have no such setting, so none is shown.
export const effortLevels = (model: string): Effort[] => {
  if (/^claude/i.test(model)) {
    return [...EFFORTS];
  }
  if (/gpt-oss/i.test(model)) {
    return ["low", "medium", "high"];
  }
  return [];
};

// The level to actually send for a model: the one asked for if the model has it, the nearest it has if not (xhigh and max become
// high on a model that stops there), and nothing for a model that cannot be told.
export const effortFor = (model: string, wanted: Effort | undefined): Effort | undefined => {
  const levels = effortLevels(model);
  if (wanted === undefined || levels.length === 0) {
    return undefined;
  }
  return levels.includes(wanted) ? wanted : levels.at(-1);
};
