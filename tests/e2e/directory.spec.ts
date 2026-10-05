import type { Page } from '@playwright/test';
import { test, expect, noHorizontalScroll } from './fixtures';

const LISTS = ['/venues/', '/performers/', '/instructors/', '/organizers/', '/styles/'];

/** Card names whose words are split across two lines (a word whose letters sit on more than one line). */
async function wordsSplitAcrossLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const a of Array.from(document.querySelectorAll<HTMLElement>('.person-card__name a'))) {
      if (a.closest<HTMLElement>('[data-dir-item]')?.hidden) continue;
      const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        // Hyphens and slashes are normal places to wrap, so each part is checked on its own.
        const re = /[^\s\-\u2010-\u2014/]+/g;
        for (let m = re.exec(node.data); m; m = re.exec(node.data)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const lines = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lines.size > 1) bad.push(`${a.textContent?.trim()}: "${m[0]}"`);
        }
      }
    }
    return bad;
  });
}

const columns = (page: Page) => page.locator('.person-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);

test.describe('directory cards', () => {
  for (const width of [320, 390, 1280]) {
    test.describe(`${width} px`, () => {
      test.use({ viewport: { width, height: 800 } });
      for (const path of LISTS) {
        test(`names never break in the middle of a word: ${path}`, async ({ pinned: page }) => {
          await page.goto(path);
          await expect(page.locator('.person-card').first()).toBeVisible();
          expect(await wordsSplitAcrossLines(page)).toEqual([]);
          await noHorizontalScroll(page);
        });
      }
    });
  }

  test('a long venue name wraps between words at 320 px, using the full card width', async ({ pinned: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/venues/');
    const card = page.locator('.person-card', { hasText: 'First Dance Wedding and Social Dance Studio' }).first();
    await expect(card).toBeVisible();
    const name = card.locator('.person-card__name');
    const [cardBox, nameBox] = [await card.boundingBox(), await name.boundingBox()];
    expect(nameBox!.width).toBeGreaterThan(cardBox!.width * 0.75);
    expect(await wordsSplitAcrossLines(page)).toEqual([]);
  });

  test('1 column on phones, 2 on small tablets, 3 on desktops, never narrower than 17rem', async ({ pinned: page }) => {
    await page.goto('/venues/');
    for (const [width, cols] of [[390, 1], [700, 2], [1280, 3], [1600, 3]] as const) {
      await page.setViewportSize({ width, height: 800 });
      expect(await columns(page), `${width} px`).toBe(cols);
      if (cols > 1) expect((await page.locator('.person-card').first().boundingBox())!.width).toBeGreaterThanOrEqual(17 * 16 - 1);
    }
  });

  test('cards have one main link, a Like button and pictures that do not shift the layout', async ({ pinned: page }) => {
    await page.goto('/performers/');
    const cards = page.locator('.person-card');
    const n = await cards.count();
    expect(n).toBeGreaterThan(50);
    await expect(page.locator('.person-card [data-react] [data-like]')).toHaveCount(n);
    await expect(cards.first().locator('[data-like]')).toHaveAccessibleName(/^Like/);
    const imgs = await page.locator('.person-card img').evaluateAll((els) => els.map((e) => ({ w: e.getAttribute('width'), h: e.getAttribute('height'), loading: e.getAttribute('loading'), src: e.getAttribute('src') })));
    expect(imgs.length).toBeGreaterThan(20);
    for (const img of imgs) {
      expect(img.w, img.src ?? '').toMatch(/^\d+$/);
      expect(img.h, img.src ?? '').toMatch(/^\d+$/);
      expect(img.loading).toBe('lazy');
      expect(img.src).toMatch(/\.webp$/);
    }
    for (const card of (await cards.all()).slice(0, 10)) await expect(card.locator('.person-card__name a')).toHaveCount(1);
  });
});

test.describe('directory filters', () => {
  test('venues: search, town and "coming up" filters hide other cards and empty counties', async ({ pinned: page }) => {
    await page.goto('/venues/');
    const total = await page.locator('.person-card').count();
    await page.locator('#d-q').fill('moose');
    await expect(page.locator('[data-dir-count]')).toContainText(/Showing \d+ of/);
    for (const card of await page.locator('.person-card:visible').all()) await expect(card).toContainText(/moose/i);
    await page.locator('#d-q').fill('');
    await page.locator('#d-town').selectOption('Patchogue');
    const visible = page.locator('.person-card:visible');
    expect(await visible.count()).toBeGreaterThan(0);
    for (const card of await visible.all()) await expect(card.locator('.person-card__kicker')).toHaveText(/Patchogue/i);
    await expect(page.locator('#c-Nassau')).toBeHidden();
    await expect(page).toHaveURL(/town=Patchogue/);
    await page.locator('#d-town').selectOption('');
    await page.getByRole('checkbox', { name: 'Only ones with events coming up' }).check();
    expect(await page.locator('.person-card:visible').count()).toBeLessThan(total);
    for (const card of await page.locator('.person-card:visible').all()) await expect(card.locator('.person-card__count')).toContainText('coming up');
  });

  test('bands and DJs: the DJs chip shows only DJs and keeps the choice in the address', async ({ pinned: page }) => {
    await page.goto('/performers/?kind=dj');
    await expect(page.locator('#g-band')).toBeHidden();
    await expect(page.locator('#g-dj')).toBeVisible();
    for (const card of await page.locator('.person-card:visible').all()) await expect(card).toHaveAttribute('data-f-kind', 'dj');
    await page.locator('label.chip', { hasText: 'All' }).click();
    await expect(page.locator('#g-band')).toBeVisible();
    await expect(page).not.toHaveURL(/kind=/);
  });
});

test.describe('directory detail pages', () => {
  test('a venue with a photo shows it at the top with a credit, contact links and JSON-LD', async ({ pinned: page }) => {
    await page.goto('/venues/');
    const href = await page.locator('.person-card:has(.person-card__media:not(.person-card__media--logo):not(.person-card__media--blank) > img) .person-card__name a').first().getAttribute('href');
    await page.goto(href!);
    const hero = page.locator('.page-header .entity-hero');
    await expect(hero.locator('img').first()).toBeVisible();
    expect((await hero.locator('img').first().getAttribute('alt'))!.length).toBeGreaterThan(3);
    await expect(page.locator('#contact')).toBeVisible();
    const tel = page.locator('#contact a[href^="tel:+1"]');
    if (await tel.count()) await expect(tel.first()).toHaveAttribute('href', /^tel:\+1\d{10}$/);
    await expect(page.locator('#contact .entity-credits')).toContainText('Pictures:');
    const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((b) => JSON.parse(b));
    const place = blocks.find((b) => b['@id']?.endsWith('#place'));
    expect(place.image[0]).toMatch(/^https?:\/\/.+\.webp$/);
    expect(place.address.addressRegion).toBe('NY');
  });

  test('a page without a photo or logo keeps the full-width header (no empty picture column)', async ({ pinned: page }) => {
    await page.goto('/performers/');
    const href = await page.locator('.person-card:has(.person-card__media--blank) .person-card__name a').first().getAttribute('href');
    await page.goto(href!);
    await expect(page.locator('.page-header')).toBeVisible();
    await expect(page.locator('.page-header--media, .page-header__media')).toHaveCount(0);
  });

  test('dance style pages credit their openly licensed photos', async ({ pinned: page }) => {
    await page.goto('/styles/east-coast-swing/');
    await expect(page.locator('.entity-hero img')).toBeVisible();
    await expect(page.locator('.entity-hero__credit')).toContainText(/Wikimedia Commons/);
    await expect(page.locator('.entity-credits')).toContainText('not from Long Island events');
  });

  test.describe('320 px', () => {
    test.use({ viewport: { width: 320, height: 640 } });
    for (const path of ['/venues/the-villager-farmingdale/', '/performers/almost-elton-and-almost-billy/', '/instructors/donna-desimone/']) {
      test(`no sideways scrolling: ${path}`, async ({ pinned: page }) => {
        await page.goto(path);
        await noHorizontalScroll(page);
      });
    }
  });
});
