import AxeBuilder from '@axe-core/playwright';
import { test, expect, noHorizontalScroll, firstEventUrl } from './fixtures';

const PAGES = [
  '/',
  '/events/',
  '/events/map/',
  '/events/calendar/',
  '/events/past/',
  '/venues/',
  '/venues/huntington-moose-lodge/',
  '/organizers/',
  '/organizers/swing-dance-long-island/',
  '/instructors/',
  '/instructors/lourdes-cruz/',
  '/performers/',
  '/performers/dj-ray/',
  '/styles/',
  '/styles/west-coast-swing/',
  '/towns/',
  '/towns/greenlawn/',
  '/sources/',
  '/about/',
  '/faq/',
  '/privacy/',
  '/community-rules/',
  '/account/',
  '/moderate/',
  '/this-page-does-not-exist/',
];

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const path of [...PAGES, 'first event page']) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`no serious or critical violations (${scheme}): ${path}`, async ({ pinned: page }) => {
        // The full event lists hold hundreds of identical cards; scanning them all takes longer.
        if (path === '/events/' || path === '/events/calendar/') test.setTimeout(180_000);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path === 'first event page' ? await firstEventUrl(page) : path);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.leaflet-container').analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([]);
      });
    }
  }
});

test.describe('keyboard navigation', () => {
  test('skip link is the first stop and moves focus to the main content', async ({ pinned: page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('mobile menu opens and closes with the keyboard', async ({ pinned: page, isMobile }) => {
    test.skip(!isMobile, 'The menu button only exists on small screens');
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Menu' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Events' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('the share dialog opens and closes with the keyboard', async ({ pinned: page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.goto(await firstEventUrl(page));
    const btn = page.locator('.action-bar [data-share-open]');
    test.skip(!(await btn.isVisible()), 'The quick-action bar only shows on small screens');
    await btn.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Share this event' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('every interactive element on the events page has a visible focus indicator', async ({ pinned: page }) => {
    await page.goto('/events/');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const has = (n: Element | null) => {
          if (!n) return false;
          const s = getComputedStyle(n);
          return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
        };
        return has(el) || has(el.nextElementSibling) || has(el.closest('.event-card, .card'));
      });
      expect(outline).toBeTruthy();
    }
  });
});

test.describe('narrow screens (320 px)', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const path of [...PAGES, 'first event page']) {
    test(`no sideways scrolling: ${path}`, async ({ pinned: page }) => {
      await page.goto(path === 'first event page' ? await firstEventUrl(page) : path);
      await noHorizontalScroll(page);
    });
  }

  test('quick links and filter chips are at least 44 px tall', async ({ pinned: page }) => {
    await page.goto('/');
    for (const link of await page.locator('.quick-link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto('/events/');
    for (const chip of (await page.locator('.filters .chip span').all()).slice(0, 6)) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

test.describe('SEO metadata', () => {
  test('every key page has a unique title, description and canonical URL', async ({ page }) => {
    const titles = new Set<string>();
    for (const path of PAGES.filter((p) => !p.includes('does-not-exist'))) {
      await page.goto(path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
      expect(titles.has(title), `duplicate title "${title}"`).toBe(false);
      titles.add(title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{40,}/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${escapeRegExp(path)}$`));
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https?:\/\//);
      expect(await page.locator('h1').count()).toBe(1);
    }
  });

  test('event pages have a share picture with alt text and When/Where labels for link previews', async ({ page }) => {
    await page.goto(await firstEventUrl(page));
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toMatch(/\/(social\.png|og\/series\/.+\.png)$/);
    await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute('content', 'image/png');
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /.{20,}/);
    await expect(page.locator('meta[name="twitter:label1"]')).toHaveAttribute('content', 'When');
    await expect(page.locator('meta[name="twitter:label2"]')).toHaveAttribute('content', 'Where');
    const res = await page.request.get(new URL(image!).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('every venue page has its own share picture', async ({ page }) => {
    await page.goto('/venues/');
    const href = await page.locator('a[href^="/venues/"][href$="/"]:not([href="/venues/"])').first().getAttribute('href');
    await page.goto(href!);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toMatch(/\/og\/venues\/.+\.jpg$/);
    await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute('content', 'image/jpeg');
    expect((await page.request.get(new URL(image!).pathname)).status()).toBe(200);
  });

  test('event pages include Event structured data with the place and organizer', async ({ page }) => {
    await page.goto(await firstEventUrl(page));
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const event = blocks.map((b) => JSON.parse(b)).find((d) => d['@type'] === 'DanceEvent' || d['@type'] === 'EducationEvent');
    expect(event.startDate).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2})?$/);
    expect(event.location.address.addressRegion).toBe('NY');
    expect(event.eventAttendanceMode).toContain('Offline');
  });
});
