import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeviceThatAcceptsChanges, UsageOverAWeek } from "./views.stories";

// The same pages at phone width, to look at in Storybook (pick the size in the toolbar, or it opens at 375x667). In the tests they
// are rendered and checked for accessibility problems like every other story; jsdom has no screen, so the width itself is not tested.
export default { title: "Pages/On a phone", parameters: { layout: "padded" } } satisfies Meta;

const phone = { viewport: { value: "phone", isRotated: false } };
const phoneTall = { viewport: { value: "phoneTall", isRotated: false } };

export const DevicesOnAPhone: StoryObj = { ...DeviceThatAcceptsChanges, globals: phone };

export const UsageOnAPhone: StoryObj = { ...UsageOverAWeek, globals: phone };

export const UsageOnATallPhone: StoryObj = { ...UsageOverAWeek, globals: phoneTall };
