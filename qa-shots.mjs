import { chromium } from 'playwright';
const [base, out, tag] = process.argv.slice(2);
const pages = ['/', '/events/', '/events/2026-10-08-dancxchange-classes-thursdays/', '/venues/'];
const views = [
  { name: 'phone320', width: 320, height: 720, scheme: 'light' },
  { name: 'phone-dark', width: 390, height: 844, scheme: 'dark' },
  { name: 'desktop', width: 1440, height: 900, scheme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, scheme: 'dark' },
];
const browser = await chromium.launch();
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: v.scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'load', timeout: 60000 }); await page.waitForTimeout(1500);
    const css = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const imgs = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').length);
    await page.screenshot({ path: `${out}/${tag}-${(p.replace(/\//g, '_').replace(/^_|_$/g, '') || 'home')}-${v.name}.png` });
    console.log(tag, v.name, p, 'overflowX', overflow, 'brokenImgs', imgs, 'font', css.split(',')[0]);
  }
  console.log(tag, v.name, 'console errors', errors.length, JSON.stringify([...new Set(errors)].slice(0, 4)));
  await ctx.close();
}
await browser.close();

