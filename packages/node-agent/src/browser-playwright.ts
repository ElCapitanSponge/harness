import { chromium, type Page } from "playwright-core";
import type { BrowserLike, PageLike } from "./browser.js";

// The real browser behind the agent browser: Playwright driving a Chrome, Edge or Chromium that is already on the machine. The launch
// has no persistent profile (Playwright gives it a temporary one and deletes it when the browser closes), nothing is downloaded, and
// the context refuses downloads and permissions and blocks service workers.

const LAUNCH_ARGS = ["--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--mute-audio"];

// A CSS selector, as against words on the page.
const looksLikeSelector = (target: string): boolean => {
  return /^[#.[]|[>[\]=]|^[a-z][a-z0-9-]*[.#:[]/i.test(target.trim());
};

const adapt = (page: Page): PageLike => {
  return {
    async goto(url, options) {
      return page.goto(url, options);
    },
    url: () => {
      return page.url();
    },
    title: () => {
      return page.title();
    },
    innerText: (selector, options) => {
      return page.innerText(selector, options);
    },
    ariaSnapshot: () => {
      return page.locator("body").ariaSnapshot();
    },
    async click(target, timeout) {
      const place = looksLikeSelector(target) ? page.locator(target) : page.getByText(target, { exact: false });
      await place.first().click({ timeout });
    },
    async fill(target, text, timeout) {
      const place = looksLikeSelector(target) ? page.locator(target) : page.getByLabel(target).or(page.getByPlaceholder(target));
      await place.first().fill(text, { timeout });
    },
    async press(target, key, timeout) {
      const place = looksLikeSelector(target) ? page.locator(target) : page.getByLabel(target).or(page.getByPlaceholder(target));
      await place.first().press(key, { timeout });
    },
    screenshot: () => {
      return page.screenshot({ type: "png" });
    },
    async waitForLoad() {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      await page.waitForTimeout(300);
    },
  };
};

export const launchPlaywright = async (executablePath: string): Promise<BrowserLike> => {
  const browser = await chromium.launch({ executablePath, headless: true, args: LAUNCH_ARGS });
  return {
    async newContext() {
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", permissions: [], viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: false });
      let main: Page | undefined;
      // A page the site opens in another window is closed at once: the model works in one.
      context.on("page", (p) => {
        if (main && p !== main) {
          void p.close();
        }
      });
      return {
        async page() {
          main = await context.newPage();
          return adapt(main);
        },
        async guard(allow) {
          await context.route("**/*", async (route) => {
            if (await allow(route.request().url())) {
              await route.continue();
            } else {
              await route.abort("blockedbyclient");
            }
          });
        },
        close: () => {
          return context.close();
        },
      };
    },
    close: () => {
      return browser.close();
    },
  };
};
