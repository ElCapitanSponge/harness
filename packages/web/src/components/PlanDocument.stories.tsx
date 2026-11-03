import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { PlanDocument } from "./PlanDocument";

const FIRST = "# Fix the Windows build\n\n## Steps\n\n1. Read `scripts/build.ts`\n2. Use `path.join`\n3. Run `pnpm test`";
const SECOND = `${FIRST}\n4. Check the lockfile`;

const meta = {
  title: "Session panel/Plan document",
  component: PlanDocument,
  // The panel is narrow, and a drawer at phone width: the document has to read in that column.
  decorators: [
    (Story) => {
      return <div className="w-72 border p-3"><Story /></div>;
    },
  ],
} satisfies Meta<typeof PlanDocument>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneVersion: Story = {
  args: { versions: [{ version: 1, markdown: FIRST, by: "model" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Fix the Windows build", level: 1 })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Download .md" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Older version" })).toBeNull();
  },
};

export const EditedByYou: Story = {
  args: { versions: [{ version: 1, markdown: FIRST, by: "model" }, { version: 2, markdown: SECOND, by: "person" }] },
  play: async ({ canvasElement }) => {
    // The version in force is shown, and the first one is a step back.
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Version 2 of 2, edited by you")).toBeVisible();
    await expect(canvas.getByText("Check the lockfile")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Older version" }));
    await expect(canvas.getByText("Version 1 of 2, written by the model")).toBeVisible();
    await expect(canvas.queryByText("Check the lockfile")).toBeNull();
  },
};
