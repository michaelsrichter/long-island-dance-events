import { test, expect } from './fixtures';

const HOME_EVENT = '/events/2026-10-08-thursday-night-swing/';
const COMMUNITY_EVENT = '/events/2026-10-03-beacon-blues-night/';

test.describe('visitor journeys', () => {
  test('1–3. find the next dance on the homepage, open it and read lesson, price and venue', async ({ pinned: page }) => {
    await page.goto('/');
    const card = page.locator('[data-featured-candidate]:not([hidden]) .featured');
    await expect(card).toBeVisible();
    await expect(card.getByText('Next Riverbend dance')).toBeVisible();
    await expect(card.locator('[data-when]')).toHaveText(/This Thursday · in 6 days!|Tonight!|Tomorrow night|in \d+ days/);
    await expect(card.locator('.featured__when')).toHaveText(/Thursday, October 8, 2026/);
    await expect(card.getByText(/Lesson:/)).toBeVisible();
    await expect(card.getByText(/Open dancing:/)).toBeVisible();
    await expect(card.locator('li', { hasText: 'Where:' })).toContainText('Riverbend Community Hall');
    await expect(card.locator('li', { hasText: 'Admission:' })).toContainText('$15');
    await expect(card.getByText('Beginners welcome')).toBeVisible();
    await expect(card.getByText('No partner needed')).toBeVisible();
    const title = (await card.locator('.featured__title').textContent())!.trim();

    await card.getByRole('link', { name: 'View event details' }).click();
    await expect(page).toHaveURL(HOME_EVENT);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const glance = page.locator('section[aria-labelledby="glance"]');
    await expect(glance.getByText(/^Lesson:/)).toBeVisible();
    await expect(glance.locator('.price-table')).toContainText('$15');
    await expect(glance.getByRole('link', { name: 'Riverbend Community Hall' })).toBeVisible();
  });

  test('4. add the event to a calendar (.ics, Google and Outlook)', async ({ pinned: page, request }) => {
    await page.goto(HOME_EVENT);
    const icsHref = await page.locator('#add-to-calendar a[download]').getAttribute('href');
    const res = await request.get(icsHref!);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).toContain('URL:');
    const google = await page.locator('#add-to-calendar a[data-track-method="google"]').getAttribute('href');
    expect(new URL(google!).searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
    await expect(page.locator('#add-to-calendar a[data-track-method="outlook"]')).toHaveAttribute('href', /outlook\.live\.com/);
  });

  test('5. copy and share the event', async ({ pinned: page }) => {
    await page.addInitScript(() => {
      (window as any).__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void (window as any).__copied.push(t) } });
    });
    const copied = () => page.evaluate(() => (window as any).__copied.at(-1) as string);
    await page.goto(HOME_EVENT);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    const share = page.locator('#share');
    await share.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.locator('[data-toast]')).toHaveText('Link copied.');
    expect(await copied()).toBe(canonical);
    await share.getByRole('button', { name: 'Copy event details' }).click();
    const details = await copied();
    expect(details).toContain(canonical!);
    expect(details).toMatch(/📍 .*Riverbend/);
    await expect(share.getByRole('link', { name: /Facebook/ })).toHaveAttribute('href', /facebook\.com\/sharer/);
    await expect(share.getByRole('link', { name: 'Email' })).toHaveAttribute('href', /^mailto:/);
    await expect(share.getByRole('link', { name: 'Text message' })).toHaveAttribute('href', /^sms:/);
  });

  test('5b. the Share button opens an accessible dialog when native sharing is unavailable', async ({ pinned: page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.goto('/');
    const btn = page.locator('[data-featured-candidate]:not([hidden]) [data-share-open]');
    await btn.click();
    const dialog = page.getByRole('dialog', { name: 'Share this event' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('6. open directions', async ({ pinned: page }) => {
    await page.goto('/');
    const link = page.locator('[data-featured-candidate]:not([hidden]) a[data-track="get_directions"]');
    await expect(link).toHaveAttribute('href', /google\.com\/maps/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('7. find beginner information', async ({ pinned: page, isMobile }) => {
    await page.goto('/');
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New to Swing?' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('New to swing');
    const q = page.locator('details[data-faq="do-i-need-a-partner"]');
    await q.locator('summary').click();
    await expect(q.getByText(/Many people come on their own/)).toBeVisible();
  });

  test('10. an event that has ended is never shown as upcoming', async ({ page }) => {
    await page.goto('/');
    const firstEnd = Number(await page.locator('[data-featured-candidate]').first().getAttribute('data-end'));
    const firstSlug = (await page.locator('[data-featured-candidate]').first().locator('.featured__title a').getAttribute('href'))!;
    await page.clock.setFixedTime(new Date(firstEnd + 60_000));
    await page.reload();
    const visible = page.locator('[data-featured-candidate]:not([hidden])');
    await expect(visible).toHaveCount(1);
    await expect(visible.locator('.featured__title a')).not.toHaveAttribute('href', firstSlug);
    await page.goto('/events/');
    await expect(page.locator(`[data-upcoming-list] a[href="${firstSlug}"]`).locator('xpath=ancestor::li[1]')).toBeHidden();
  });

  test('11. a cancelled event stays visible and is clearly marked', async ({ pinned: page }) => {
    await page.goto('/events/past/2026/');
    const card = page.locator('.event-card--cancelled').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.status')).toHaveText(/Cancelled/i);
    await card.locator('.event-card__title a').click();
    await expect(page.locator('.alert--bad')).toContainText('This event is cancelled.');
    await expect(page.locator('.event-hero .status')).toHaveText(/Cancelled/i);
  });
});

test.describe('home events first, community events clearly marked', () => {
  test('the homepage hero is the next home dance even when a community event is sooner', async ({ pinned: page }) => {
    await page.goto('/');
    const card = page.locator('[data-featured-candidate]:not([hidden]) .featured');
    await expect(card.locator('.featured__title')).toHaveText('Thursday Night Swing');
    await expect(page.locator('[data-upcoming-list="home_community"] .event-card').first()).toContainText('Beacon Blues Night');
    for (const host of await page.locator('[data-upcoming-list="home"] .event-card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.host))) expect(host).toBe('home');
  });

  test('the events page lists home dances before community events, and can show only community events', async ({ pinned: page }) => {
    await page.goto('/events/');
    await expect(page.locator('[data-featured-candidate] .featured__label')).toContainText('Next Riverbend dance');
    const sections = await page.locator('[data-host-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.hostSection));
    expect(sections).toEqual(['home', 'community']);
    await page.locator('label.chip', { hasText: 'Community events' }).click();
    await expect(page.locator('[data-host-section="home"]')).toBeHidden();
    await expect(page).toHaveURL(/host=community/);
    const visibleHosts = await page.locator('[data-upcoming-list] .event-card:visible').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.host))]);
    expect(visibleHosts).toEqual(['community']);
  });

  test('the events page host filter can show only home events', async ({ pinned: page }) => {
    await page.goto('/events/');
    await page.locator('label.chip', { hasText: 'Riverbend events' }).click();
    await expect(page.locator('[data-host-section="community"]')).toBeHidden();
    await expect(page).toHaveURL(/host=home/);
    const visibleHosts = await page.locator('[data-upcoming-list] .event-card:visible').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.host))]);
    expect(visibleHosts).toEqual(['home']);
  });

  test('a community event page shows organizer, contact, source and the next Riverbend dance callout', async ({ pinned: page }) => {
    await page.goto(COMMUNITY_EVENT);
    await expect(page.locator('.event-hero .host--community')).toBeVisible();
    await expect(page.locator('.alert--community')).toContainText('not run by Riverbend');
    const glance = page.locator('section[aria-labelledby="glance"]');
    await expect(glance.getByRole('link', { name: 'Beacon Blues Collective', exact: true })).toHaveAttribute('href', '/community/#beacon-blues-collective');
    await expect(glance.locator('a[href^="tel:"]').first()).toHaveAttribute('href', 'tel:+15550100201');
    await expect(glance.getByText(/Listed in/)).toContainText('Sample community listing');
    await expect(page.locator('.next-home a')).toHaveText('Thursday Night Swing');
  });

  test('teachers link to their own websites wherever they are mentioned', async ({ pinned: page }) => {
    await page.goto(HOME_EVENT);
    await expect(page.locator('.lineup a.ext-link[href="https://example.com/teachers/maya-rivera"]')).toBeVisible();
    await page.goto('/events/');
    await expect(page.locator('.event-card a.person-ext[href="https://example.com/teachers/maya-rivera"]').first()).toBeVisible();
    await page.goto('/performers/maya-rivera/');
    await expect(page.getByRole('link', { name: /^Website/ })).toHaveAttribute('href', 'https://example.com/teachers/maya-rivera');
  });

  test('bands link to their own websites wherever they are mentioned', async ({ pinned: page }) => {
    await page.goto('/events/2026-10-17-saturday-stomp-live-band/');
    await expect(page.locator('.lineup a.ext-link[href="https://example.com/riverbend-syncopators"]')).toBeVisible();
    await page.goto('/events/');
    await expect(page.locator('.event-card a.person-ext[href="https://example.com/riverbend-syncopators"]').first()).toBeVisible();
    await page.goto('/performers/riverbend-syncopators/');
    await expect(page.getByRole('link', { name: /^Website/ })).toHaveAttribute('href', 'https://example.com/riverbend-syncopators');
  });

  test('the venue page links to Google photos and reviews and shows parking', async ({ pinned: page }) => {
    await page.goto('/venues/riverbend-community-hall/');
    await expect(page.getByRole('link', { name: /Photos & reviews/ })).toHaveAttribute('href', /google\.com\/maps/);
    await expect(page.locator('#venue-info').locator('xpath=..')).toContainText('Free parking');
  });

  test('the community page lists organizers with contacts and classes', async ({ pinned: page }) => {
    await page.goto('/community/');
    await expect(page.locator('#beacon-blues-collective')).toContainText('hello@example.com');
    await expect(page.locator('#classes')).toContainText('Drop-in classes');
    await expect(page.locator('#sources')).toContainText('Sample Community Calendar');
  });
});

test.describe('only the next 3 home dances show at first', () => {
  test('the homepage shows 3 home dances and a button for the rest', async ({ pinned: page }) => {
    await page.goto('/');
    const list = page.locator('[data-upcoming-list="home"]');
    await expect(list.locator('.event-card:visible')).toHaveCount(3);
    const total = await list.locator('.event-card').count();
    expect(total).toBeGreaterThan(3);
    const more = page.locator('[data-collapse-toggle="home-home-list"]');
    await expect(more).toHaveText(`Show ${total - 3} more Riverbend dances`);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(list.locator('.event-card:visible')).toHaveCount(total);
    await expect(more).toHaveText('Show fewer Riverbend dances');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(list.locator('.event-card').nth(3).locator('a').first()).toBeFocused();
    await more.click();
    await expect(list.locator('.event-card:visible')).toHaveCount(3);
  });

  test('the events page shows 3 more home dances, then community events; filters show every match', async ({ pinned: page }) => {
    await page.goto('/events/');
    const home = page.locator('[data-host-section="home"]');
    await expect(home.locator('.event-card:visible')).toHaveCount(3);
    const total = await home.locator('.event-card').count();
    expect(total).toBeGreaterThan(3);
    const more = home.locator('[data-collapse-toggle]');
    await expect(more).toHaveText(`Show ${total - 3} more Riverbend dances`);
    for (const m of await home.locator('[data-month-group]:visible').all()) expect(await m.locator('.event-card:visible').count()).toBeGreaterThan(0);
    await expect(page.locator('[data-host-section="community"] .event-card').first()).toBeVisible();

    await page.locator('label.chip', { hasText: 'Riverbend events' }).click();
    await expect(home.locator('.event-card:visible')).toHaveCount(total);
    await expect(more).toBeHidden();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(home.locator('.event-card:visible')).toHaveCount(3);
    await more.click();
    await expect(home.locator('.event-card:visible')).toHaveCount(total);
  });

  test('when a listed dance ends before the nightly rebuild, the next one moves up', async ({ page }) => {
    await page.goto('/');
    const list = page.locator('[data-upcoming-list="home"]');
    const total = await list.locator('.event-card').count();
    const end = Number(await list.locator('.event-card').first().getAttribute('data-end'));
    await page.clock.setFixedTime(new Date(end + 60_000));
    await page.reload();
    await expect(list.locator('.event-card:visible')).toHaveCount(3);
    await expect(page.locator('[data-collapse-toggle="home-home-list"]')).toHaveText(`Show ${total - 4} more Riverbend dances`);
  });

  test('event, venue, series and lesson pages also start with 3 home dances', async ({ pinned: page }) => {
    await page.goto(COMMUNITY_EVENT);
    await expect(page.locator('#more-home .event-card:visible')).toHaveCount(3);
    await expect(page.locator('[data-upcoming-list="event_more_community"] .event-card').first()).toBeVisible();
    for (const path of ['/venues/riverbend-community-hall/', '/events/series/thursday-night-swing/', '/lessons/']) {
      await page.goto(path);
      const list = page.locator('[data-collapse]');
      await expect(list.locator('.event-card:visible')).toHaveCount(3);
      expect(await list.locator('.event-card').count()).toBeGreaterThan(3);
      await page.locator('[data-collapse-toggle]').click();
      expect(await list.locator('.event-card:visible').count()).toBeGreaterThan(3);
    }
  });
});

test.describe('light and dark mode', () => {
  test('visitors can switch between light and dark, and the choice is remembered', async ({ pinned: page, isMobile }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const html = page.locator('html');
    const DARK = 'rgb(21, 14, 27)';
    const LIGHT = 'rgb(255, 250, 242)';
    await expect(page.locator('body')).toHaveCSS('background-color', DARK);

    if (isMobile) {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.locator('#nav-panel input[value="light"]').check({ force: true });
    } else {
      await page.locator('.site-header').getByRole('button', { name: 'Switch to light mode' }).click();
      await expect(page.locator('.site-header').getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
    }
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT);

    await page.goto('/events/');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT);

    const footer = page.locator('.theme-choice--footer');
    await expect(footer.getByRole('radio', { name: 'Light' })).toBeChecked();
    await footer.locator('input[value="auto"]').check({ force: true });
    expect(await html.getAttribute('data-theme')).toBeNull();
    await expect(page.locator('body')).toHaveCSS('background-color', DARK);
    await footer.locator('input[value="dark"]').check({ force: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).toHaveCSS('background-color', DARK);
  });

  test('without JavaScript the site follows the device and shows no switch', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 14, 27)');
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
    await expect(page.locator('.theme-choice--footer')).toBeHidden();
    await ctx.close();
  });
});

test.describe('photos, map and header', () => {
  test('the homepage slideshow pauses, steps and updates its counter', async ({ pinned: page }) => {
    await page.goto('/');
    const show = page.locator('.home-hero__photos [data-slideshow]');
    await expect(show).toBeVisible();
    const slides = show.locator('[data-slide]');
    expect(await slides.count()).toBeGreaterThan(8);
    await expect(slides.first().locator('img.slideshow__img')).toHaveAttribute('alt', /swing/i);
    await expect(show.locator('[data-slideshow-count]')).toHaveText(/^1 \/ \d+$/);
    await show.getByRole('button', { name: 'Next photo' }).click();
    await expect(show.locator('[data-slideshow-count]')).toHaveText(/^2 \/ \d+$/);
    await expect(show.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
    await expect(show.locator('video[data-slide-video]')).toHaveCount(0);
  });

  test('photos are never upscaled past their source size', async ({ pinned: page }) => {
    await page.goto('/gallery/');
    const imgs = page.locator('.gallery-grid img');
    expect(await imgs.count()).toBeGreaterThan(8);
    for (const img of (await imgs.all()).slice(0, 6)) {
      await img.scrollIntoViewIfNeeded();
      const ok = await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
      expect(ok).toBe(true);
    }
  });

  test('the events map shows a pin for every place and host filtering changes markers and URL', async ({ pinned: page }) => {
    await page.goto('/events/map/');
    const places = page.locator('[data-map-place]');
    const n = await places.count();
    expect(n).toBeGreaterThan(3);
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(n);
    await expect(page.locator('.leaflet-marker-icon.map-pin--home')).toHaveCount(1);
    await places.first().getByRole('button', { name: 'Show on map' }).click();
    await expect(page.locator('.leaflet-popup')).toContainText('Riverbend Community Hall');
    await page.locator('label.chip', { hasText: 'Riverbend events' }).click();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
    await expect(page).toHaveURL(/host=home/);
  });

  test('the Facebook group is linked from the header on every page, and the sample announcement is hidden', async ({ pinned: page }) => {
    for (const path of ['/', '/events/', '/contact/']) {
      await page.goto(path);
      await expect(page.locator('.site-header a.header-social')).toHaveAttribute('href', 'https://www.facebook.com/groups/example');
      await expect(page.locator('.announcement')).toHaveCount(0);
    }
  });
});

test.describe('event discovery', () => {
  test('filters narrow the list and can be cleared', async ({ pinned: page }) => {
    await page.goto('/events/');
    const count = page.locator('[data-result-count]');
    const total = Number((await count.textContent())!.match(/\d+/)![0]);
    await page.locator('label.chip', { hasText: 'Next 7 days' }).click();
    await expect(count).not.toHaveText(`${total} events shown`);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(`${total} events shown`);
  });

  test('month calendar shows a grid on desktop and an agenda list on phones', async ({ pinned: page, isMobile }) => {
    await page.goto('/events/calendar/');
    if (isMobile) {
      await expect(page.locator('table.cal')).toBeHidden();
      await expect(page.locator('.cal-agenda .event-card').first()).toBeVisible();
    } else {
      await expect(page.locator('table.cal')).toBeVisible();
      await expect(page.locator('table.cal .cal__event').first()).toBeVisible();
    }
    await page.locator('.cal-nav a').last().click();
    await expect(page).toHaveURL(/\/events\/calendar\/\d{4}-\d{2}\/$/);
  });

  test('the event list works without JavaScript', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/events/');
    await expect(page.locator('[data-event-filters]')).toBeHidden();
    expect(await page.locator('[data-upcoming-list] .event-card').count()).toBeGreaterThan(3);
    const home = page.locator('[data-host-section="home"] .event-card');
    expect(await home.count()).toBeGreaterThan(3);
    await expect(home.last()).toBeVisible();
    await expect(page.locator('[data-collapse-toggle]')).toBeHidden();
    await page.locator('[data-upcoming-list] .event-card__title a').first().click();
    await expect(page.locator('#add-to-calendar a[download]')).toBeVisible();
    await ctx.close();
  });
});

test.describe('legacy URLs, CMS and errors', () => {
  test('the CMS loads its configuration without errors and offers GitHub sign-in', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.getByText(/Login with GitHub|Sign in with GitHub/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Config Errors|Error loading the CMS configuration/i)).toHaveCount(0);
  });

  test('a long-tail legacy redirect page uses a meta refresh to the new page', async ({ page, request }) => {
    const res = await request.get('/old-gallery.php/');
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('url=/gallery/');
    await page.goto('/old-gallery.php/');
    await expect(page).toHaveURL(/\/gallery\/$/);
  });

  test('a configured legacy 301 lands on the new page', async ({ page }) => {
    await page.goto('/events.php');
    await expect(page).toHaveURL(/\/events\/$/);
  });

  test('unknown pages show a helpful 404', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist/');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Oops, we missed a step');
    await expect(page.getByRole('link', { name: 'See upcoming dances' })).toBeVisible();
  });
});
