import { test, expect, firstEventUrl } from './fixtures';

test.describe('finding something to dance to', () => {
  test('the homepage leads with dances, shows today, quick links with counts, and a search box', async ({ pinned: page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dance and live music on Long Island');
    await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
    const quick = page.getByRole('navigation', { name: 'Quick links' });
    for (const name of [/^This week(?!end)/, /^Today/, /^This weekend/, /^Live music/, /^Classes/, /^Map/]) await expect(quick.getByRole('link', { name })).toBeAttached();
    // Dances and live music come first; classes have their own, shorter section.
    for (const c of await page.locator('[data-upcoming-list="home_week"] [data-event]').all()) expect(await c.getAttribute('data-category')).not.toBe('class-lesson');
    for (const c of await page.locator('[data-upcoming-list="home_classes"] [data-event]').all()) await expect(c).toHaveAttribute('data-category', 'class-lesson');
    await page.getByRole('searchbox', { name: 'Search events' }).fill('hustle');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/events\/\?(.*&)?q=hustle/);
    await expect(page.locator('input[name="category"][value="all"]')).toBeChecked();
    await expect(page.locator('#f-q')).toHaveValue('hustle');
    const cards = page.locator('[data-upcoming-list] [data-event]:not([hidden])');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const c of (await cards.all()).slice(0, 5)) await expect(c).toContainText(/hustle/i);
  });

  test('quick links open the events list already filtered', async ({ pinned: page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Quick links' }).getByRole('link', { name: /Classes/ }).click();
    await expect(page).toHaveURL(/category=class-lesson/);
    const visible = page.locator('[data-upcoming-list] [data-event]:not([hidden])');
    expect(await visible.count()).toBeGreaterThan(0);
    for (const c of (await visible.all()).slice(0, 10)) await expect(c).toHaveAttribute('data-category', 'class-lesson');
  });

  test('filters narrow the list, sync to the URL and can be cleared', async ({ pinned: page }) => {
    await page.goto('/events/');
    const count = page.locator('[data-result-count]');
    const total = Number((await count.textContent())!.match(/\d+/)![0]);
    await page.locator('#f-style').selectOption('west-coast-swing');
    await expect(page).toHaveURL(/style=west-coast-swing/);
    const n = Number((await count.textContent())!.match(/\d+/)![0]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(total);
    for (const c of await page.locator('[data-upcoming-list] [data-event]:not([hidden])').all()) await expect(c).toHaveAttribute('data-styles', /west-coast-swing/);
    await page.locator('.filters__more > summary').click();
    await page.locator('#f-county').selectOption('Nassau');
    for (const c of await page.locator('[data-upcoming-list] [data-event]:not([hidden])').all()) await expect(c).toHaveAttribute('data-county', 'Nassau');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(`${total} events shown`);
  });

  test('day-of-week, price and teacher filters work together', async ({ pinned: page }) => {
    await page.goto('/events/?day=tuesday');
    await expect(page.locator('.filters__more')).toHaveAttribute('open', '');
    const visible = page.locator('[data-upcoming-list] [data-event]:not([hidden])');
    for (const c of await visible.all()) await expect(c).toHaveAttribute('data-weekday', 'tuesday');
    await page.locator('#f-person').selectOption({ index: 1 });
    const person = await page.locator('#f-person').inputValue();
    for (const c of await visible.all()) await expect(c).toHaveAttribute('data-people', new RegExp(person));
  });

  test('the events list starts with dances and live music; classes are one tap away', async ({ pinned: page }) => {
    await page.goto('/events/');
    await expect(page.locator('input[name="category"][value="dances"]')).toBeChecked();
    const visible = page.locator('[data-upcoming-list] [data-event]:not([hidden])');
    // One read for the whole list (hundreds of events): faster, and not upset by the list re-rendering.
    const categories = await visible.evaluateAll((els) => els.map((e) => e.getAttribute('data-category')));
    const dances = categories.length;
    expect(dances).toBeGreaterThan(0);
    expect(categories).not.toContain('class-lesson');
    await page.locator('.chip', { hasText: 'Everything' }).click();
    await expect(page).toHaveURL(/category=all/);
    expect(await visible.count()).toBeGreaterThan(dances);
    await page.locator('.chip', { hasText: 'Classes' }).click();
    for (const c of (await visible.all()).slice(0, 10)) await expect(c).toHaveAttribute('data-category', 'class-lesson');
  });

  test('only Nassau and Suffolk events are listed', async ({ pinned: page }) => {
    await page.goto('/events/');
    const counties = await page.locator('[data-upcoming-list] [data-event]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.county))]);
    expect(counties.filter((c) => c && !['Nassau', 'Suffolk'].includes(c))).toEqual([]);
    await expect(page.locator('[data-upcoming-list]')).not.toContainText(/Queens|Brooklyn|Little Neck/);
  });
});

test.describe('an event page', () => {
  test('answers when, where, how much and who runs it, and credits the source', async ({ pinned: page }) => {
    await page.goto(await firstEventUrl(page));
    const glance = page.locator('section[aria-labelledby="glance"]');
    for (const label of ['When', 'Where', 'Price', 'Type and level', 'Organizer']) await expect(glance.locator('dt', { hasText: label })).toBeVisible();
    await expect(page.locator('.alert--community')).toContainText('Check with the organizer before you go');
    const source = page.locator('#source');
    await expect(source).toContainText('written by us');
    await expect(source.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
    await expect(source.getByRole('link', { name: 'Report a problem with this listing' })).toHaveAttribute('href', /^https:\/\/github\.com\/michaelsrichter\/long-island-dance-events\/issues\/new\?template=listing-correction\.yml/);
  });

  test('can be added to a calendar (.ics, Google and Outlook)', async ({ pinned: page, request }) => {
    await page.goto(await firstEventUrl(page));
    const icsHref = await page.locator('#add-to-calendar a[download]').getAttribute('href');
    const res = await request.get(icsHref!);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toMatch(/DTSTART(;TZID=[^:]+|;VALUE=DATE)?:\d{8}/);
    const google = await page.locator('#add-to-calendar a[data-track-method="google"]').getAttribute('href');
    expect(new URL(google!).searchParams.get('dates')).toMatch(/^\d{8}(T\d{6}Z)?\/\d{8}(T\d{6}Z)?$/);
    await expect(page.locator('#add-to-calendar a[data-track-method="outlook"]')).toHaveAttribute('href', /^https:\/\/outlook\.live\.com\/calendar\//);
  });

  test('can be shared, and the link is copied', async ({ pinned: page }) => {
    await page.addInitScript(() => {
      (window as any).__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void (window as any).__copied.push(t) } });
    });
    await page.goto(await firstEventUrl(page));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    const share = page.locator('#share');
    await share.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.locator('[data-toast]')).toHaveText('Link copied.');
    expect(await page.evaluate(() => (window as any).__copied.at(-1))).toBe(canonical);
    await expect(share.getByRole('link', { name: /Facebook/ })).toHaveAttribute('href', /^https:\/\/www\.facebook\.com\/sharer\//);
  });

  test('links to its venue, which lists what is on there', async ({ pinned: page }) => {
    await page.goto('/events/?when=all');
    const card = page.locator('[data-upcoming-list] [data-event]:not([data-venue=""]):not([hidden])').first();
    const venue = await card.getAttribute('data-venue');
    await card.locator('.event-card__title a').click();
    await page.locator('section[aria-labelledby="glance"] a[href^="/venues/"]').click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venue}/$`));
    expect(await page.locator('[data-upcoming-list="entity"] [data-event]').count()).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /^Google Maps/ }).first()).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps[/?]/);
  });

  test('a repeating event says how often it repeats and lists other dates', async ({ pinned: page }) => {
    await page.goto('/events/');
    const repeating = page.locator('[data-upcoming-list] .event-card:not([hidden])', { hasText: /Every (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/ }).first();
    await repeating.locator('.event-card__title a').click();
    await expect(page.locator('.hero-facts')).toContainText(/Every \w+day/);
  });

  test('an event that has ended is hidden from upcoming lists without a rebuild', async ({ page }) => {
    await page.goto('/events/');
    const first = page.locator('[data-upcoming-list] [data-event]:not([hidden])').first();
    const end = Number(await first.getAttribute('data-end'));
    const href = await first.locator('.event-card__title a').getAttribute('href');
    await page.clock.setFixedTime(new Date(end + 60_000));
    await page.reload();
    await expect(page.locator(`[data-upcoming-list] a[href="${href}"]`).locator('xpath=ancestor::li[1]')).toBeHidden();
  });
});

test.describe('directory pages link everything together', () => {
  test('organizer, teacher, band/DJ and style pages list their upcoming events', async ({ pinned: page }) => {
    for (const path of ['/organizers/dancxchange/', '/instructors/lourdes-cruz/', '/performers/dj-ray/', '/styles/hustle/']) {
      await page.goto(path);
      expect(await page.locator('[data-upcoming-list="entity"] [data-event]').count(), path).toBeGreaterThan(0);
    }
  });

  test('a teacher named on an event links to their page, which shows their own links', async ({ pinned: page }) => {
    await page.goto('/instructors/');
    await page.getByRole('link', { name: 'Lourdes Cruz', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lourdes Cruz');
    await expect(page.locator('.ext-links a').first()).toHaveAttribute('target', '_blank');
  });

  test('the sources page credits every source and explains corrections and takedowns', async ({ pinned: page }) => {
    await page.goto('/sources/');
    await expect(page.getByRole('link', { name: 'The Dance Calendar' })).toHaveAttribute('href', /^https:\/\/www\.thedancecalendar\.com\//);
    await expect(page.getByRole('heading', { name: 'Dance calendars' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live-music lists' })).toBeVisible();
    await expect(page.locator('#src-music').locator('xpath=..')).toContainText("Ira's List");
    await expect(page.locator('#corrections')).toContainText('Remove my events');
    await expect(page.locator('#takedown')).toContainText('takedown request');
  });
});

test.describe('views', () => {
  test('month calendar shows a grid on desktop and an agenda list on phones', async ({ pinned: page, isMobile }) => {
    await page.goto('/events/calendar/');
    if (isMobile) {
      await expect(page.locator('table.cal')).toBeHidden();
      for (const past of await page.locator('.cal-agenda .event-card--past').all()) await expect(past).toBeHidden();
      await expect(page.locator('.cal-agenda .event-card:not(.event-card--past)').first()).toBeVisible();
    } else {
      await expect(page.locator('table.cal')).toBeVisible();
      await expect(page.locator('table.cal .cal__event').first()).toBeVisible();
    }
  });

  test('the map shows a pin for every place, and the type filter changes markers and URL', async ({ pinned: page }) => {
    await page.goto('/events/map/');
    await page.locator('[data-events-map]').scrollIntoViewIfNeeded();
    const places = page.locator('[data-map-place]');
    const n = await places.count();
    expect(n).toBeGreaterThan(3);
    // Dances and live music first: places with only classes are hidden until "Everything" is chosen.
    const dancePlaces = await page.locator('[data-map-place]:not([hidden])').count();
    expect(dancePlaces).toBeGreaterThan(0);
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(dancePlaces);
    await page.locator('label.chip', { hasText: 'Everything' }).click();
    await expect(page).toHaveURL(/type=all/);
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(n);
    await page.locator('label.chip', { hasText: 'Classes' }).click();
    await expect(page).toHaveURL(/type=class/);
    expect(await page.locator('.leaflet-marker-icon').count()).toBeLessThan(n);
  });

  test('the event list works without JavaScript', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/events/');
    await expect(page.locator('[data-event-filters]')).toBeHidden();
    expect(await page.locator('[data-upcoming-list] .event-card').count()).toBeGreaterThan(3);
    await page.locator('[data-upcoming-list] .event-card__title a').first().click();
    await expect(page.locator('#add-to-calendar a[download]')).toBeVisible();
    await ctx.close();
  });
});

test.describe('light and dark mode', () => {
  test('visitors can switch between light and dark, and the choice is remembered', async ({ pinned: page, isMobile }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const html = page.locator('html');
    const DARK = 'rgb(10, 10, 12)';
    const LIGHT = 'rgb(246, 246, 248)';
    await expect(page.locator('body')).toHaveCSS('background-color', DARK);
    if (isMobile) {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.locator('#nav-panel input[value="light"]').check({ force: true });
    } else {
      await page.locator('.site-header').getByRole('button', { name: 'Switch to light mode' }).click();
    }
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.goto('/events/');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT);
    const footer = page.locator('.theme-choice--footer');
    await footer.locator('input[value="auto"]').check({ force: true });
    expect(await html.getAttribute('data-theme')).toBeNull();
    await expect(page.locator('body')).toHaveCSS('background-color', DARK);
  });
});

test.describe('CMS and errors', () => {
  test('the CMS loads its configuration without errors and offers GitHub sign-in', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.getByText(/Login with GitHub|Sign in with GitHub/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Config Errors|Error loading the CMS configuration/i)).toHaveCount(0);
  });

  test('unknown pages show a helpful 404', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist/');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Oops, we missed a step');
    await expect(page.getByRole('link', { name: 'See upcoming events' })).toBeVisible();
  });
});

test.describe('can you dance there?', () => {
  test('shows where people mostly sit and listen, and keeps those shows out of the dance list', async ({ pinned: page }) => {
    await page.goto('/events/?category=all');
    const quiet = page.locator('[data-upcoming-list] [data-event][data-dancing="unlikely"]:not([hidden])');
    expect(await quiet.count()).toBeGreaterThan(0);
    const href = (await quiet.first().locator('.event-card__title a').getAttribute('href'))!;
    await page.goto('/events/');
    await expect(page.locator(`[data-upcoming-list] [data-event]:not([hidden]) .event-card__title a[href="${href}"]`)).toHaveCount(0);
    await page.goto(href);
    const panel = page.locator('[data-dancing-panel]');
    await expect(panel.getByRole('heading', { name: 'Can you dance here?' })).toBeVisible();
    await expect(panel.getByRole('img', { name: /Dancing score: [0-3] out of 10/ })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'How the score works' })).toHaveAttribute('href', '/faq/#dancing-score');
  });

  test('the kind-of-dancing filter keeps only that kind, and venue pages explain their dancing', async ({ pinned: page }) => {
    await page.goto('/events/?category=all');
    await page.locator('.chip', { hasText: 'Line dancing' }).click();
    await expect(page).toHaveURL(/dance=line/);
    const visible = page.locator('[data-upcoming-list] [data-event]:not([hidden])');
    expect(await visible.count()).toBeGreaterThan(0);
    for (const c of await visible.all()) await expect(c).toHaveAttribute('data-dance-kinds', /\bline\b/);
    const hrefs = await visible.locator('.event-card__title a').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!))]);
    await page.goto(hrefs[0]!);
    await expect(page.locator('[data-dancing-panel] .dance-kinds')).toContainText('Line dancing');
    // Venues we have researched explain their dancing. New venues from the weekly run may not be researched yet,
    // so look through the line-dancing events until one is at a researched venue.
    let found = false;
    for (const href of hrefs.slice(0, 25)) {
      await page.goto(href);
      const venue = await page.locator('main a[href^="/venues/"]').first().getAttribute('href');
      if (!venue) continue;
      await page.goto(venue);
      if (await page.getByRole('heading', { name: /^Dancing at / }).count()) {
        await expect(page.locator('#dancing')).toContainText(/Line dancing|Party dancing|Partner dancing/);
        found = true;
        break;
      }
    }
    expect(found, 'at least one line-dancing event is at a venue with dancing research').toBe(true);
  });

  test('a dance-calendar listing is always a dance event', async ({ pinned: page }) => {
    await page.goto('/events/?category=all');
    const href = await page.locator('[data-upcoming-list] [data-event][data-category="social-dance"][data-dancing="dance-event"]:not([hidden]) .event-card__title a').first().getAttribute('href');
    await page.goto(href!);
    await expect(page.locator('[data-dancing-panel]')).toHaveAttribute('data-level', 'dance-event');
  });
});
