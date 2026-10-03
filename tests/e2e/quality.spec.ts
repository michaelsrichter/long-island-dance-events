import AxeBuilder from '@axe-core/playwright';
import { test, expect, noHorizontalScroll } from './fixtures';

const PAGES = [
  '/',
  '/events/',
  '/events/map/',
  '/events/calendar/',
  '/events/past/',
  '/events/past/2026/',
  '/events/series/thursday-night-swing/',
  '/events/2026-10-08-thursday-night-swing/',
  '/events/2026-10-03-beacon-blues-night/',
  '/community/',
  '/new-to-swing/',
  '/lessons/',
  '/venues/',
  '/venues/riverbend-community-hall/',
  '/venues/juniper-grange/',
  '/performers/',
  '/performers/maya-rivera/',
  '/about/',
  '/membership/',
  '/gallery/',
  '/contact/',
  '/faq/',
  '/privacy/',
  '/this-page-does-not-exist/',
];

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const path of PAGES) {
    test(`no serious or critical violations: ${path}`, async ({ pinned: page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([]);
    });
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

  test('add-to-calendar menu works with the keyboard', async ({ pinned: page }) => {
    await page.goto('/');
    const summary = page.locator('[data-featured-candidate]:not([hidden]) details[data-menu] > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    const google = page.locator('[data-featured-candidate]:not([hidden]) details[data-menu] a[data-track-method="google"]');
    await expect(google).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(google).toBeHidden();
  });

  test('every interactive element has a visible focus indicator', async ({ pinned: page }) => {
    await page.goto('/events/');
    for (let i = 0; i < 12; i++) {
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
  for (const path of PAGES) {
    test(`no sideways scrolling: ${path}`, async ({ pinned: page }) => {
      await page.goto(path);
      await noHorizontalScroll(page);
    });
  }

  test('touch targets in the next-dance card are at least 44 px tall', async ({ pinned: page }) => {
    await page.goto('/');
    const targets = page.locator('[data-featured-candidate]:not([hidden]) .btn-row :is(a.btn, summary.btn, button.btn)');
    const n = await targets.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      const box = await targets.nth(i).boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

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
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https?:\/\//);
      expect(await page.locator('h1').count()).toBe(1);
    }
  });

  test('event pages include valid Event structured data', async ({ page }) => {
    await page.goto('/events/2026-10-17-saturday-stomp-live-band/');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const event = blocks.map((b) => JSON.parse(b)).find((d) => d['@type'] === 'DanceEvent');
    expect(event.startDate).toBe('2026-10-17T19:30:00-04:00');
    expect(event.location.address.addressLocality).toBe('Riverbend');
    expect(event.performer[0]['@type']).toBe('MusicGroup');
  });
});
