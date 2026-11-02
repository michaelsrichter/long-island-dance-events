import { openFilters, test, expect, noHorizontalScroll } from './fixtures';

const visibleCards = '[data-upcoming-list] [data-event]:not([hidden])';

test.describe('feature badges', () => {
  test('event cards show badges for what is there, with an icon and a word, never repeating the category', async ({ pinned: page }) => {
    await page.goto('/events/?category=all');
    const badges = page.locator(`${visibleCards} .feat-badge`);
    expect(await badges.count()).toBeGreaterThan(0);
    for (const b of (await badges.all()).slice(0, 20)) {
      await expect(b.locator('.fi')).toHaveCount(1);
      expect((await b.textContent())!.trim().length).toBeGreaterThan(1);
    }
    // "Live band" on a live-music card only when an act is named (it then tells a band from a singer); a class never says "Lesson" again.
    for (const card of (await page.locator('[data-event][data-category="live-music"]:has(.feat-badge--live)').all()).slice(0, 10)) await expect(card).toContainText('Live:');
    await expect(page.locator('[data-event][data-category="class-lesson"] .feat-badge--lesson')).toHaveCount(0);
    // Badges agree with the filter data.
    for (const card of (await page.locator(`${visibleCards}:has(.feat-badge--dj)`).all()).slice(0, 5)) await expect(card).toHaveAttribute('data-features', /\bdj\b/);
  });

  test('map rows and calendar entries show the same features', async ({ pinned: page }) => {
    await page.goto('/events/map/?category=all');
    expect(await page.locator('.map-place__events .feat-badge').count()).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events/calendar/?category=all');
    const icons = page.locator('.cal__event .cal__feats');
    expect(await icons.count()).toBeGreaterThan(0);
    // Screen readers hear the features in words.
    const entry = page.locator('.cal__event:has(.cal__feats)').first();
    await expect(entry.locator('.visually-hidden').last()).toHaveText(/\((?:[^)]*)(DJ|Live band|Lesson|Free)/);
    await expect(page.locator('.host-legend .legend-icon').first()).toBeVisible();
  });
});

test.describe('filters on the list, calendar and map', () => {
  test('"What\'s there" chips narrow the list and go in the address', async ({ pinned: page }) => {
    await page.goto('/events/?category=all');
    const before = await page.locator(visibleCards).count();
    await page.locator('label.chip', { hasText: 'DJ' }).click();
    await expect(page).toHaveURL(/has=dj/);
    const cards = page.locator(visibleCards);
    expect(await cards.count()).toBeGreaterThan(0);
    expect(await cards.count()).toBeLessThan(before);
    for (const c of (await cards.all()).slice(0, 15)) await expect(c).toHaveAttribute('data-features', /\bdj\b/);
  });

  test('filters follow you from the list to the map and the calendar', async ({ pinned: page }) => {
    await page.goto('/events/?category=all&has=dj');
    const mapLink = page.getByRole('navigation', { name: 'Event views' }).getByRole('link', { name: 'Map' });
    await expect(mapLink).toHaveAttribute('href', /has=dj/);
    await mapLink.click();
    await expect(page).toHaveURL(/\/events\/map\/\?.*has=dj/);
    await expect(page.locator('input[name="has"][value="dj"]')).toBeChecked();
    await expect(page.locator('input[name="category"][value="all"]')).toBeChecked();
    for (const place of (await page.locator('[data-map-place]:not([hidden])').all()).slice(0, 10)) {
      expect(await place.locator('[data-map-event]:not([hidden])[data-features~="dj"]').count()).toBeGreaterThan(0);
    }
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(await page.locator('[data-map-place]:not([hidden])').count());
    const calLink = page.getByRole('navigation', { name: 'Event views' }).getByRole('link', { name: 'Month calendar' });
    await expect(calLink).toHaveAttribute('href', /has=dj/);
    await calLink.click();
    await expect(page).toHaveURL(/\/events\/calendar\/\?.*has=dj/);
    await expect(page.locator('[data-cal-pending]')).toHaveCount(0);
    await expect(page.locator('input[name="has"][value="dj"]')).toBeChecked();
    for (const e of await page.locator('[data-cal-event]:not([hidden])').all()) await expect(e).toHaveAttribute('data-features', /\bdj\b/);
  });

  test('old map links with ?type= still work', async ({ pinned: page }) => {
    await page.goto('/events/map/?type=all');
    await expect(page.locator('input[name="category"][value="all"]')).toBeChecked();
    await expect(page).toHaveURL(/category=all/);
  });

  test('the calendar shows dances and live music first, and classes with one tap', async ({ pinned: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events/calendar/');
    for (const e of (await page.locator('[data-cal-event]:not([hidden])').all()).slice(0, 30)) expect(await e.getAttribute('data-category')).not.toBe('class-lesson');
    await page.locator('label.chip', { hasText: 'Classes' }).click();
    await expect(page).toHaveURL(/category=class-lesson/);
    for (const e of (await page.locator('[data-cal-event]:not([hidden])').all()).slice(0, 30)) await expect(e).toHaveAttribute('data-category', 'class-lesson');
    // Month arrows keep the filters.
    const next = page.locator('.cal-nav a[data-carry-filters]').last();
    if (await next.count()) await expect(next).toHaveAttribute('href', /category=class-lesson/);
  });

  test('a crowded calendar day shows 3 events and a "+N more" button', async ({ pinned: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events/calendar/?category=all');
    const crowded = page.locator('td[data-cal-day]:has([data-cal-more])').first();
    test.skip((await crowded.count()) === 0, 'No day this month has more than 3 events');
    await expect(crowded.locator('[data-cal-event]:not([hidden])')).toHaveCount(3);
    const more = crowded.locator('[data-cal-more]');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const label = (await more.textContent())!;
    const extra = Number(label.match(/\+(\d+) more/)![1]);
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(crowded.locator('[data-cal-event]:not([hidden])')).toHaveCount(3 + extra);
    await more.click();
    await expect(crowded.locator('[data-cal-event]:not([hidden])')).toHaveCount(3);
  });

  test('on phones the calendar and map filters start folded and say how many are on', async ({ pinned: page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ['/events/map/?has=dj', '/events/calendar/?has=dj&category=all']) {
      await page.goto(path);
      const panel = page.locator('[data-filters-panel]');
      expect(await panel.getAttribute('open'), path).toBeNull();
      await expect(panel.locator('.filters-panel__toggle')).toContainText(path.includes('category') ? '2 on' : '1 on');
      await panel.locator('.filters-panel__toggle').click();
      await expect(page.locator('input[name="has"][value="dj"]')).toBeChecked();
      await expect(page.locator('label.chip', { hasText: 'DJ' })).toBeVisible();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events/map/');
    await expect(page.locator('[data-filters-panel]')).toHaveAttribute('open', '');
  });

  test.describe('320 px', () => {
    test.use({ viewport: { width: 320, height: 640 } });
    for (const path of ['/events/calendar/?category=all&has=dj', '/events/map/?category=all&has=free']) {
      test(`no sideways scrolling with filters set: ${path}`, async ({ pinned: page }) => {
        await page.goto(path);
        await openFilters(page);
        await page.locator('.filters__more > summary').click();
        await noHorizontalScroll(page);
      });
    }
  });
});

test.describe('the calendar arrives in its filtered state (nothing jumps)', () => {
  test('the page and the script agree on what shows by default', async ({ pinned: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const html = await (await page.request.get('/events/calendar/')).text();
    const servedMore = (html.match(/data-cal-more/g) ?? []).length;
    await page.goto('/events/calendar/');
    await expect(page.locator('[data-cal-pending]')).toHaveCount(0);
    // The server marks with data-off exactly what the script then hides.
    const mismatches = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-cal-event], .cal-agenda [data-event]')].filter((e) => e.hidden !== e.hasAttribute('data-off')).length,
    );
    expect(mismatches).toBe(0);
    expect(await page.locator('[data-cal-event][data-off]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-cal-more]').count()).toBe(servedMore);
  });

  for (const width of [412, 1280]) {
    test(`little layout shift when the filters start, ${width} px`, async ({ pinned: page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto('/events/calendar/', { waitUntil: 'load' });
      await expect(page.locator('[data-cal-pending]')).toHaveCount(0);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.05);
      expect(await page.locator('[data-filters-panel]').getAttribute('open')).toBe(width >= 768 ? '' : null);
    });
  }

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('every calendar event shows and there are no "+N more" buttons', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/events/calendar/');
      const all = await page.locator('[data-cal-event]').count();
      expect(all).toBeGreaterThan(0);
      const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-cal-event], [data-cal-more]')].filter((e) => getComputedStyle(e).display === 'none').map((e) => e.hasAttribute('data-cal-more')));
      expect(hidden.filter((isMore) => !isMore)).toHaveLength(0);
      expect(hidden.length).toBe(await page.locator('[data-cal-more]').count());
    });
  });
});
