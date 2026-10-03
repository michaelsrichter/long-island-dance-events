// Screenshot helper: node shots.mjs <baseUrl> <outDir> [paths...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4321', out = 'shots', ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ['/', '/events/', '/events/2026-10-08-thursday-night-swing/'];
const views = [
  { name: 'mobile', width: 390, height: 844, scheme: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, scheme: 'dark' },
  { name: 'desktop', width: 1440, height: 900, scheme: 'light' },
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: v.scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const name = `${out}/${(p.replace(/\//g, '_') || 'home').replace(/^_|_$/g, '') || 'home'}-${v.name}.png`;
    await page.screenshot({ path: name, fullPage: process.env.FULL === '1' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(v.name, p, 'overflowX', overflow, '->', name);
  }
  if (errors.length) console.log('console errors', v.name, errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
