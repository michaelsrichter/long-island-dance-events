import { test as base, expect, type Page } from '@playwright/test';

/**
 * Test builds use BUILD_NOW (see scripts/build-now.mjs: 8 AM on the day of the latest scrape).
 * The browser clock is pinned to the same moment so "upcoming", "Today" and relative dates match the build.
 */
export const BUILD_NOW = process.env.BUILD_NOW || '2026-10-03T08:00:00-04:00';

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

/** URL of the first upcoming event on /events/ (the data changes every week, so tests look it up). */
export async function firstEventUrl(page: Page, selector = '[data-upcoming-list] [data-event]:not([hidden]) .event-card__title a'): Promise<string> {
  await page.goto('/events/');
  const href = await page.locator(selector).first().getAttribute('href');
  expect(href).toMatch(/^\/events\/\d{4}-\d{2}-\d{2}-/);
  return href!;
}

/** On the calendar and map, phones start with the filters folded behind a "Filters" button; open it if needed. */
export async function openFilters(page: Page) {
  const panel = page.locator('[data-filters-panel]');
  if ((await panel.count()) && (await panel.getAttribute('open')) === null) await panel.locator('.filters-panel__toggle').click();
}
