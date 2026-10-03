import { test as base, expect, type Page } from '@playwright/test';

/** The build used for end-to-end tests is generated with BUILD_NOW; the browser clock is pinned to the same moment. */
export const BUILD_NOW = process.env.BUILD_NOW || '2026-10-01T22:00:00-04:00';

export const test = base.extend<{ pinned: Page }>({
  pinned: async ({ page }, use) => {
    if (!process.env.E2E_BASE_URL) await page.clock.setFixedTime(new Date(BUILD_NOW));
    await use(page);
  },
});
export { expect };

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll sideways').toBeLessThanOrEqual(0);
}
